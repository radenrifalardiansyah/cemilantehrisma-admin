import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';
import { readProductsForDeltas, applyStockDelta, writeStockLedgerEntry } from '@/lib/stock';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');
  const db = getDb();

  let query: Query<DocumentData> = db.collection('orders').orderBy('createdAt', 'desc');
  if (from) query = query.where('createdAt', '>=', Timestamp.fromDate(new Date(`${from}T00:00:00`)));
  if (to)   query = query.where('createdAt', '<=', Timestamp.fromDate(new Date(`${to}T23:59:59.999`)));
  if (!from && !to) {
    const limit = parseInt(searchParams.get('limit') ?? '50');
    query = query.limit(limit);
  }

  const snap = await query.get();
  const orders = snap.docs.map(d => {
    const data = d.data();
    const createdAt = data.createdAt as Timestamp | undefined;
    return { id: d.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null };
  });
  return Response.json({ orders });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as Record<string, unknown> & {
    transactionAt?: string; invoiceNo?: string;
    items?: { productId?: string; qty: number }[];
    warehouseId?: string; warehouseName?: string;
  };
  const { transactionAt, ...rest } = data;
  const db = getDb();
  // Kasir bisa mengedit tanggal & jam transaksi (mis. transaksi baru sempat diinput belakangan) —
  // kalau dikirim, itu yang jadi createdAt (dipakai buat urutan & filter periode di Pesanan/Laporan
  // Keuangan). Kalau tidak dikirim, pakai waktu server seperti biasa.
  const createdAt = transactionAt ? Timestamp.fromDate(new Date(transactionAt)) : FieldValue.serverTimestamp();

  // Potong stok jadi bagian dari transaksi yang sama dengan penyimpanan order — tidak ada lagi
  // celah "order tersimpan tapi stok gagal dipotong" seperti pola fetch terpisah yang lama.
  const deltas = new Map<string, number>();
  for (const item of data.items ?? []) {
    if (!item.productId || !item.qty) continue;
    deltas.set(item.productId, (deltas.get(item.productId) ?? 0) - item.qty);
  }

  let orderId = '';
  try {
    await db.runTransaction(async tx => {
      const { products, shortages } = await readProductsForDeltas(tx, db, deltas);
      if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

      const ref = db.collection('orders').doc();
      orderId = ref.id;
      tx.set(ref, {
        ...rest,
        status: 'done',
        source: 'kasir',
        stockCut: true,
        createdAt,
      });

      for (const [productId, delta] of deltas) {
        const product = products.get(productId)!;
        applyStockDelta(tx, db, { productId, product, warehouseId: data.warehouseId, delta });
        writeStockLedgerEntry(tx, db, {
          productId, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'out', qty: delta,
          note: `Penjualan Kasir - ${data.invoiceNo ?? ''}`,
        });
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan transaksi.' }, { status: 400 });
  }

  return Response.json({ id: orderId });
}
