import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { revalidateStorefront } from '@/lib/revalidate';
import { writeStockLedgerEntryPg, stockLabel, captureAndSetWs, type WsSnapshot } from '@/lib/stock-pg';
import { rowToShipment, type ShipmentRow } from '@/lib/shipments-pg';

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
// Konsinyasi setiap kali dibuka (plus tiap tampilan laporan berperiode). TTL pendek (15s, sama
// seperti orders) menjaga tampilan tetap terasa langsung sambil menyerap lonjakan baca yang
// terjadi bersamaan. (Tahap 18a migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md.)
const getCachedShipments = unstable_cache(
  async (from: string | null, to: string | null, limit: number) => {
    const sql = getSql();
    let rows: ShipmentRow[];
    if (from && to) {
      rows = await sql<ShipmentRow[]>`select * from consignment_shipments where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
    } else if (from) {
      rows = await sql<ShipmentRow[]>`select * from consignment_shipments where created_at >= ${wibDayStart(from).toDate()} order by created_at desc`;
    } else if (to) {
      rows = await sql<ShipmentRow[]>`select * from consignment_shipments where created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
    } else {
      rows = await sql<ShipmentRow[]>`select * from consignment_shipments order by created_at desc limit ${limit}`;
    }
    return rows.map(rowToShipment);
  },
  ['admin-consignment-shipments-list'],
  { revalidate: 15, tags: ['admin-consignment-shipments-list'] },
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
  const shipmentId = randomUUID();

  // Stok (products/warehouse_stock/stock_ledger/consignmentStock, Tahap 8-10) DAN dokumen
  // pengiriman (Tahap 18a) sekarang sama-sama di Postgres, jadi digabung jadi SATU transaksi
  // atomic — tidak ada lagi kompensasi cross-database seperti versi sebelumnya. Lihat pola yang
  // sama di orders/route.ts (Tahap 12) & consignment/recap/route.ts (Tahap 13).
  const itemsWithSubtotal = items.map(it => ({ ...it, subtotal: it.qty * it.hargaTitip }));
  const createdAt = data.date ? new Date(data.date) : new Date();

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

      const wsSnapshots: WsSnapshot[] = [];
      for (const [i, it] of items.entries()) {
        const row = productById.get(productIds[i])!;
        const oldQty = Number(row.stock_qty) || 0;
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
        const newStockQty = oldStockQty + it.qty;
        const newHarga = newStockQty > 0 ? (oldStockQty * oldHarga + it.qty * it.hargaTitip) / newStockQty : 0;
        await pgTx`
          insert into consignment_stock (id, location_id, product_id, product_name, stock_qty, harga_titip, updated_at)
          values (${stockKey}, ${data.locationId}, ${it.productId}, ${it.productName}, ${newStockQty}, ${newHarga}, now())
          on conflict (id) do update set stock_qty = ${newStockQty}, harga_titip = ${newHarga}, updated_at = now()
        `;
      }

      await pgTx`
        insert into consignment_shipments (id, location_id, location_name, warehouse_id, warehouse_name, items, note, created_at)
        values (${shipmentId}, ${data.locationId}, ${data.locationName}, ${data.warehouseId}, ${data.warehouseName ?? ''}, ${JSON.stringify(itemsWithSubtotal)}, ${data.note ?? ''}, ${createdAt})
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan pengiriman.' }, { status: 400 });
  }

  // History/notifikasi tetap Firestore (di luar cakupan Tahap 18a) — best-effort setelah
  // transaksi Postgres commit, sama pola dengan orders/route.ts & consignment/recap/route.ts.
  const shipmentDoc = {
    locationId: data.locationId, locationName: data.locationName,
    warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
    items: itemsWithSubtotal, note: data.note ?? '',
  };
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentShipments',
      entityId: shipmentId,
      entityLabel: `${data.locationName ?? 'Kirim Konsinyasi'}${data.date ? ` - ${data.date}` : ''}`,
      action: 'create',
      actor: guard,
      after: shipmentDoc,
    });
  } catch (err) {
    console.error('Failed to write history for consignment send create', err);
  }
  const totalQty = itemsWithSubtotal.reduce((s, it) => s + it.qty, 0);
  try {
    await notify(db, {
      type: 'consignment_send',
      title: 'Kirim stok konsinyasi',
      message: `${totalQty} pcs dikirim ke ${data.locationName} — oleh ${guard.username}.`,
      link: 'consignment',
      entityCollection: 'consignmentShipments', entityId: shipmentId,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to send notification for consignment send', err);
  }

  revalidateTag('admin-consignment-shipments-list', { expire: 0 });
  after(() => revalidateStorefront('products'));

  return Response.json({ id: shipmentId });
}
