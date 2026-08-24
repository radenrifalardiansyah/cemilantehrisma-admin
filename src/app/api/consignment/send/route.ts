import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { writeHistoryEntry } from '@/lib/history';
import { writeNotification, sendPush } from '@/lib/notifications';
import { revalidateStorefront } from '@/lib/revalidate';

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

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai filter periode di tab Lokasi/Laporan
  const to   = searchParams.get('to');

  let query: Query<DocumentData> = getDb().collection('consignmentShipments').orderBy('createdAt', 'desc');
  if (from) query = query.where('createdAt', '>=', wibDayStart(from));
  if (to)   query = query.where('createdAt', '<=', wibDayEnd(to));
  if (!from && !to) {
    const limit = parseInt(searchParams.get('limit') ?? '50');
    query = query.limit(limit);
  }

  const snap = await query.get();
  const shipments = snap.docs.map(d => {
    const data = d.data();
    const createdAt = data.createdAt as Timestamp | undefined;
    return { id: d.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null };
  });
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
  const shipmentRef = db.collection('consignmentShipments').doc();

  let pushPayload: { title: string; message: string } | null = null;
  try {
    await db.runTransaction(async tx => {
      const productRefs = items.map(it => db.collection('products').doc(it.productId));
      const stockRefs   = items.map(it => db.collection('consignmentStock').doc(`${data.locationId}_${it.productId}`));
      const wsRefs      = items.map(it => db.collection('warehouse_stock').doc(`${data.warehouseId}_${it.productId}`));
      const [productSnaps, stockSnaps] = await Promise.all([
        Promise.all(productRefs.map(r => tx.get(r))),
        Promise.all(stockRefs.map(r => tx.get(r))),
      ]);

      const shortages: string[] = [];
      items.forEach((it, i) => {
        if (!productSnaps[i].exists) { shortages.push(`${it.productName} (produk tidak ditemukan)`); return; }
        const stockQty = Number(productSnaps[i].data()!.stockQty) || 0;
        if (stockQty < it.qty) shortages.push(`${it.productName} (stok toko ${stockQty}, butuh ${it.qty})`);
      });
      if (shortages.length > 0) throw new Error(`Stok produk tidak cukup untuk dikirim: ${shortages.join(', ')}`);

      const itemsWithSubtotal = items.map(it => ({ ...it, subtotal: it.qty * it.hargaTitip }));

      items.forEach((it, i) => {
        const product = productSnaps[i].data()!;
        const newQty = (Number(product.stockQty) || 0) - it.qty;
        tx.update(productRefs[i], {
          stockQty: newQty,
          stock: product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
          updatedAt: FieldValue.serverTimestamp(),
        });

        tx.set(wsRefs[i], {
          warehouseId: data.warehouseId, productId: it.productId, productName: it.productName,
          stockQty: FieldValue.increment(-it.qty), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const logRef = db.collection('stock').doc();
        tx.set(logRef, {
          warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
          productId: it.productId, productName: it.productName,
          type: 'out', qty: it.qty,
          note: `Kirim konsinyasi – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
          createdAt: FieldValue.serverTimestamp(),
        });

        const existing = stockSnaps[i].exists ? stockSnaps[i].data()! : null;
        const oldQty   = existing ? Number(existing.stockQty) || 0 : 0;
        const oldHarga = existing ? Number(existing.hargaTitip) || 0 : 0;
        const newStockQty = oldQty + it.qty;
        const newHarga = newStockQty > 0 ? (oldQty * oldHarga + it.qty * it.hargaTitip) / newStockQty : 0;
        tx.set(stockRefs[i], {
          locationId: data.locationId, productId: it.productId, productName: it.productName,
          stockQty: newStockQty, hargaTitip: newHarga, updatedAt: FieldValue.serverTimestamp(),
        });
      });

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
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan pengiriman.' }, { status: 400 });
  }

  if (pushPayload) await sendPush(db, pushPayload).catch(err => console.error('Failed to send push for consignment send', err));
  after(() => revalidateStorefront('products'));

  return Response.json({ id: shipmentRef.id });
}
