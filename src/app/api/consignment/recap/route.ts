import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';
import { wibDayStart, wibDayEnd } from '@/lib/date';

interface RecapItemInput { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject?: number }

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');
  const db = getDb();

  let query: Query<DocumentData> = db.collection('consignmentRecaps').orderBy('createdAt', 'desc');
  if (from) query = query.where('createdAt', '>=', wibDayStart(from));
  if (to)   query = query.where('createdAt', '<=', wibDayEnd(to));
  if (!from && !to) {
    const limit = parseInt(searchParams.get('limit') ?? '50');
    query = query.limit(limit);
  }

  const snap = await query.get();
  const recaps = snap.docs.map(d => {
    const data = d.data();
    const createdAt = data.createdAt as Timestamp | undefined;
    return { id: d.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null };
  });
  return Response.json({ recaps });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as {
    locationId: string; locationName: string; note?: string; items: RecapItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas';
    warehouseId?: string; warehouseName?: string; date?: string;
  };
  const items = (data.items ?? [])
    .map(it => ({ ...it, qtyReject: it.qtyReject ?? 0 }))
    .filter(it => it.qtySold > 0 || it.qtyRetur > 0 || it.qtyReject > 0);
  if (items.length === 0) return Response.json({ error: 'Isi minimal 1 produk dengan qty terjual, retur, atau reject.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';

  const hasReturnOrReject = items.some(it => it.qtyRetur > 0 || it.qtyReject > 0);
  if (hasReturnOrReject && !data.warehouseId) {
    return Response.json({ error: 'Pilih gudang tujuan untuk retur/reject.' }, { status: 400 });
  }

  const db = getDb();
  const recapRef = db.collection('consignmentRecaps').doc();

  try {
    await db.runTransaction(async tx => {
      const stockRefs = items.map(it => db.collection('consignmentStock').doc(`${data.locationId}_${it.productId}`));
      const stockSnaps = await Promise.all(stockRefs.map(r => tx.get(r)));

      const shortages: string[] = [];
      items.forEach((it, i) => {
        if (!stockSnaps[i].exists) { shortages.push(`${it.productName} (tidak ada stok titip tercatat)`); return; }
        const stockQty = Number(stockSnaps[i].data()!.stockQty) || 0;
        const requested = it.qtySold + it.qtyRetur + it.qtyReject;
        if (requested > stockQty) shortages.push(`${it.productName} (stok di lokasi ${stockQty}, diminta ${requested})`);
      });
      if (shortages.length > 0) throw new Error(`Qty melebihi stok di lokasi: ${shortages.join(', ')}`);

      // Snapshot HPP (costPrice) tiap produk saat rekap terjadi — dipakai Laporan Keuangan untuk
      // menghitung HPP barang konsinyasi yang benar-benar terjual (costPrice produk adalah rata-rata
      // bergerak, jadi HPP historis tidak bisa direkonstruksi ulang kalau tidak disimpan di sini).
      const allProductRefs = items.map(it => db.collection('products').doc(it.productId));
      const allProductSnaps = await Promise.all(allProductRefs.map(r => tx.get(r)));

      // Retur (kondisi baik) dikreditkan ke gudang tujuan — sinkron dengan endpoint stok masuk gudang.
      const returItems = items.filter(it => it.qtyRetur > 0);
      const productRefs = returItems.map(it => db.collection('products').doc(it.productId));
      const productSnaps = await Promise.all(productRefs.map(r => tx.get(r)));

      const recapItems = items.map((it, i) => {
        const hargaTitip = Number(stockSnaps[i].data()!.hargaTitip) || 0;
        const costPrice = Number(allProductSnaps[i].data()?.costPrice) || 0;
        return { ...it, hargaTitip, revenue: it.qtySold * hargaTitip, costPrice, cogs: it.qtySold * costPrice };
      });
      const totalSold    = recapItems.reduce((s, it) => s + it.qtySold, 0);
      const totalRetur   = recapItems.reduce((s, it) => s + it.qtyRetur, 0);
      const totalReject  = recapItems.reduce((s, it) => s + it.qtyReject, 0);
      const totalRevenue = recapItems.reduce((s, it) => s + it.revenue, 0);

      items.forEach((it, i) => {
        const stockQty = Number(stockSnaps[i].data()!.stockQty) || 0;
        tx.update(stockRefs[i], {
          stockQty: stockQty - it.qtySold - it.qtyRetur - it.qtyReject,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      returItems.forEach((it, i) => {
        const productSnap = productSnaps[i];
        if (!productSnap.exists) return;
        const product = productSnap.data()!;
        const newQty = (Number(product.stockQty) || 0) + it.qtyRetur;
        tx.update(productRefs[i], {
          stockQty: newQty,
          stock: product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
          updatedAt: FieldValue.serverTimestamp(),
        });

        const wsRef = db.collection('warehouse_stock').doc(`${data.warehouseId}_${it.productId}`);
        tx.set(wsRef, {
          warehouseId: data.warehouseId, productId: it.productId, productName: it.productName,
          stockQty: FieldValue.increment(it.qtyRetur), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const logRef = db.collection('stock').doc();
        tx.set(logRef, {
          warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
          productId: it.productId, productName: it.productName,
          type: 'in', qty: it.qtyRetur,
          note: `Retur konsinyasi – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      // Reject (rusak/tidak layak jual) — tidak menambah stok jual, hanya tercatat sebagai kerugian
      // di riwayat gudang (badge "Reject") supaya tetap terlihat, tanpa mengubah warehouse_stock.
      items.filter(it => it.qtyReject > 0).forEach(it => {
        const logRef = db.collection('stock').doc();
        tx.set(logRef, {
          warehouseId: data.warehouseId ?? '', warehouseName: data.warehouseName ?? '',
          productId: it.productId, productName: it.productName,
          type: 'reject', qty: it.qtyReject,
          note: `Reject konsinyasi – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      tx.set(recapRef, {
        locationId: data.locationId, locationName: data.locationName,
        items: recapItems, totalSold, totalRetur, totalReject, totalRevenue,
        paymentStatus,
        warehouseId: data.warehouseId ?? '', warehouseName: data.warehouseName ?? '',
        note: data.note ?? '',
        createdAt: data.date ? Timestamp.fromDate(new Date(data.date)) : FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan rekap.' }, { status: 400 });
  }

  return Response.json({ id: recapRef.id });
}
