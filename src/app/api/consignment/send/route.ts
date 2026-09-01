import { NextRequest, after } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { writeHistoryEntry } from '@/lib/history';
import { writeNotification, sendPush } from '@/lib/notifications';
import { revalidateStorefront } from '@/lib/revalidate';
import { writeStockLedgerEntryPg, stockLabel, captureAndSetWs, compensateStock, type ProductSnapshot, type WsSnapshot } from '@/lib/stock-pg';

interface SendItemInput { productId: string; productName: string; qty: number; hargaTitip: number }

// Gabungkan baris ganda untuk produk yang sama SEBELUM dipakai di tx.get/tx.update — tanpa ini,
// tiap baris dibaca & divalidasi dari snapshot produk yang sama, lalu tx.update dengan nilai
// literal per baris (bukan akumulatif), sehingga baris kedua menimpa hasil baris pertama dan
// stok yang benar-benar keluar dari toko tidak sepenuhnya tercatat di stockQty produk. Pola yang
// sama sudah dipakai di endpoint edit (PUT) untuk masalah persis ini.
function mergeItems(items: SendItemInput[]): SendItemInput[] {
  const merged = new Map<string, SendItemInput>();
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const existing = merged.get(it.productId);
    if (existing) {
      const totalQty = existing.qty + qty;
      existing.hargaTitip = totalQty > 0 ? (existing.qty * existing.hargaTitip + qty * it.hargaTitip) / totalQty : it.hargaTitip;
      existing.qty = totalQty;
    } else {
      merged.set(it.productId, { ...it, qty });
    }
  }
  return [...merged.values()];
}

// Sama seperti orders/route.ts & consignment/recap/route.ts: dibaca tanpa batas tanggal oleh tab
// Konsinyasi setiap kali dibuka (plus tiap tampilan laporan berperiode) — tanpa cache, itu scan
// penuh koleksi `consignmentShipments` per panggilan, dan mode date-range di bawah sebelumnya
// malah tidak dibatasi `.limit()` sama sekali. TTL pendek (15s, sama seperti orders) menjaga
// tampilan tetap terasa langsung sambil menyerap lonjakan baca yang terjadi bersamaan.
const getCachedShipments = unstable_cache(
  async (from: string | null, to: string | null, limit: number) => {
    let query: Query<DocumentData> = getDb().collection('consignmentShipments').orderBy('createdAt', 'desc');
    if (from) query = query.where('createdAt', '>=', wibDayStart(from));
    if (to)   query = query.where('createdAt', '<=', wibDayEnd(to));
    if (!from && !to) query = query.limit(limit);

    const snap = await query.get();
    return snap.docs.map(d => {
      const data = d.data();
      const createdAt = data.createdAt as Timestamp | undefined;
      return { id: d.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null };
    });
  },
  ['admin-consignment-shipments-list'],
  { revalidate: 15 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai filter periode di tab Lokasi/Laporan
  const to   = searchParams.get('to');
  const limit = parseInt(searchParams.get('limit') ?? '50');

  const shipments = await getCachedShipments(from, to, limit);
  return Response.json({ shipments });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    locationId: string; locationName: string; warehouseId: string; warehouseName?: string;
    note?: string; items: SendItemInput[]; date?: string;
  };
  const items = mergeItems(data.items ?? []);
  if (items.length === 0) return Response.json({ error: 'Minimal 1 produk dikirim.' }, { status: 400 });
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang asal pengiriman.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const shipmentRef = db.collection('consignmentShipments').doc();

  // `products`/`warehouse_stock`/`stock_ledger`/`consignmentStock` sudah pindah ke Postgres
  // (Tahap 8-10) — divalidasi & dipotong DULU di sana, baru dokumen pengiriman (Firestore, masih
  // di sana untuk sementara) ditulis. Lihat pola yang sama di orders/route.ts.
  const itemsWithSubtotal = items.map(it => ({ ...it, subtotal: it.qty * it.hargaTitip }));
  const productSnapshots: ProductSnapshot[] = [];
  const wsSnapshots: WsSnapshot[] = [];
  const consignmentStockSnapshots: { key: string; oldQty: number }[] = [];
  let stockCommitted = false;

  try {
    await sql.begin(async pgTx => {
      const productIds = items.map(it => it.productId);
      const stockKeys  = items.map(it => `${data.locationId}_${it.productId}`);
      const [productRows, stockRows] = await Promise.all([
        pgTx<{ id: string; stock_qty: string; cost_price: string | null; open_po: boolean }[]>`select id, stock_qty, cost_price, open_po from products where id in ${pgTx(productIds)} order by id for update`,
        pgTx<{ id: string; stock_qty: string; harga_titip: string | null }[]>`select id, stock_qty, harga_titip from consignment_stock where id in ${pgTx(stockKeys)} order by id for update`,
      ]);
      const productById = new Map(productRows.map(r => [r.id, r]));
      const stockById = new Map(stockRows.map(r => [r.id, r]));

      const shortages: string[] = [];
      items.forEach((it, i) => {
        const row = productById.get(productIds[i]);
        if (!row) { shortages.push(`${it.productName} (produk tidak ditemukan)`); return; }
        const stockQty = Number(row.stock_qty) || 0;
        if (stockQty < it.qty) shortages.push(`${it.productName} (stok toko ${stockQty}, butuh ${it.qty})`);
      });
      if (shortages.length > 0) throw new Error(`Stok produk tidak cukup untuk dikirim: ${shortages.join(', ')}`);

      for (const [i, it] of items.entries()) {
        const row = productById.get(productIds[i])!;
        const oldQty = Number(row.stock_qty) || 0;
        productSnapshots.push({ productId: it.productId, oldQty, oldCost: row.cost_price != null ? Number(row.cost_price) : 0, openPO: row.open_po });
        const newQty = oldQty - it.qty;
        await pgTx`update products set stock_qty = ${newQty}, stock = ${stockLabel(row.open_po, newQty)}, updated_at = now() where id = ${it.productId}`;

        await captureAndSetWs(pgTx, wsSnapshots, `${data.warehouseId}_${it.productId}`, data.warehouseId, it.productId, it.productName,
          old => old - it.qty);
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'out', qty: it.qty, note: `Kirim konsinyasi – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });

        const stockKey = stockKeys[i];
        const stockRow = stockById.get(stockKey);
        const oldStockQty = stockRow ? Number(stockRow.stock_qty) || 0 : 0;
        const oldHarga    = stockRow?.harga_titip != null ? Number(stockRow.harga_titip) : 0;
        consignmentStockSnapshots.push({ key: stockKey, oldQty: oldStockQty });
        const newStockQty = oldStockQty + it.qty;
        const newHarga = newStockQty > 0 ? (oldStockQty * oldHarga + it.qty * it.hargaTitip) / newStockQty : 0;
        await pgTx`
          insert into consignment_stock (id, location_id, product_id, product_name, stock_qty, harga_titip, updated_at)
          values (${stockKey}, ${data.locationId}, ${it.productId}, ${it.productName}, ${newStockQty}, ${newHarga}, now())
          on conflict (id) do update set stock_qty = ${newStockQty}, harga_titip = ${newHarga}, updated_at = now()
        `;
      }
    });
    stockCommitted = true;
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan pengiriman.' }, { status: 400 });
  }

  let pushPayload: { title: string; message: string } | null = null;
  try {
    await db.runTransaction(async tx => {
      const shipmentDoc = {
        locationId: data.locationId, locationName: data.locationName,
        warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
        items: itemsWithSubtotal, note: data.note ?? '',
        createdAt: data.date ? Timestamp.fromDate(new Date(data.date)) : FieldValue.serverTimestamp(),
      };
      tx.set(shipmentRef, shipmentDoc);

      const totalQty = itemsWithSubtotal.reduce((s, it) => s + it.qty, 0);
      pushPayload = writeNotification(tx, db, {
        type: 'consignment_send',
        title: 'Kirim stok konsinyasi',
        message: `${totalQty} pcs dikirim ke ${data.locationName} — oleh ${guard.username}.`,
        link: 'consignment',
        entityCollection: 'consignmentShipments', entityId: shipmentRef.id,
        actor: guard,
      });

      writeHistoryEntry(tx, db, {
        entity: 'consignment',
        entityCollection: 'consignmentShipments',
        entityId: shipmentRef.id,
        entityLabel: `${data.locationName ?? 'Kirim Konsinyasi'}${data.date ? ` - ${data.date}` : ''}`,
        action: 'create',
        actor: guard,
        after: shipmentDoc,
      });
    });
  } catch (err) {
    if (stockCommitted) {
      try {
        await Promise.all([
          compensateStock(sql, productSnapshots, wsSnapshots),
          sql.begin(async pgTx => {
            for (const s of consignmentStockSnapshots) {
              await pgTx`update consignment_stock set stock_qty = ${s.oldQty}, updated_at = now() where id = ${s.key}`;
            }
          }),
        ]);
      } catch (compErr) {
        console.error('CRITICAL: gagal kompensasi stok setelah kirim konsinyasi gagal tersimpan', compErr);
      }
    }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan pengiriman.' }, { status: 400 });
  }

  if (pushPayload) await sendPush(db, pushPayload).catch(err => console.error('Failed to send push for consignment send', err));
  after(() => revalidateStorefront('products'));

  return Response.json({ id: shipmentRef.id });
}
