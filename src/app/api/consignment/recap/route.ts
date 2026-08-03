import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';

interface RecapItemInput { productId: string; productName: string; qtySold: number; qtyRetur: number }

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');
  const db = getDb();

  let query: Query<DocumentData> = db.collection('consignmentRecaps').orderBy('createdAt', 'desc');
  if (from) query = query.where('createdAt', '>=', Timestamp.fromDate(new Date(`${from}T00:00:00`)));
  if (to)   query = query.where('createdAt', '<=', Timestamp.fromDate(new Date(`${to}T23:59:59.999`)));
  if (!from && !to) {
    const limit = parseInt(searchParams.get('limit') ?? '50');
    query = query.limit(limit);
  }

  const snap = await query.get();
  const recaps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ recaps });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as {
    locationId: string; locationName: string; note?: string; items: RecapItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas';
  };
  const items = (data.items ?? []).filter(it => it.qtySold > 0 || it.qtyRetur > 0);
  if (items.length === 0) return Response.json({ error: 'Isi minimal 1 produk dengan qty terjual atau retur.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';

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
        const requested = it.qtySold + it.qtyRetur;
        if (requested > stockQty) shortages.push(`${it.productName} (stok di lokasi ${stockQty}, diminta ${requested})`);
      });
      if (shortages.length > 0) throw new Error(`Qty melebihi stok di lokasi: ${shortages.join(', ')}`);

      const productRefs = items.map(it => it.qtyRetur > 0 ? db.collection('products').doc(it.productId) : null);
      const productSnaps = await Promise.all(productRefs.map(r => r ? tx.get(r) : Promise.resolve(null)));

      const recapItems = items.map((it, i) => {
        const hargaTitip = Number(stockSnaps[i].data()!.hargaTitip) || 0;
        return { ...it, hargaTitip, revenue: it.qtySold * hargaTitip };
      });
      const totalSold    = recapItems.reduce((s, it) => s + it.qtySold, 0);
      const totalRetur   = recapItems.reduce((s, it) => s + it.qtyRetur, 0);
      const totalRevenue = recapItems.reduce((s, it) => s + it.revenue, 0);

      items.forEach((it, i) => {
        const stockQty = Number(stockSnaps[i].data()!.stockQty) || 0;
        tx.update(stockRefs[i], {
          stockQty: stockQty - it.qtySold - it.qtyRetur,
          updatedAt: FieldValue.serverTimestamp(),
        });

        if (it.qtyRetur > 0 && productSnaps[i]) {
          const product = productSnaps[i]!.data();
          if (product) {
            const newQty = (Number(product.stockQty) || 0) + it.qtyRetur;
            tx.update(productRefs[i]!, {
              stockQty: newQty,
              stock: product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }
      });

      tx.set(recapRef, {
        locationId: data.locationId, locationName: data.locationName,
        items: recapItems, totalSold, totalRetur, totalRevenue,
        paymentStatus,
        note: data.note ?? '',
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan rekap.' }, { status: 400 });
  }

  return Response.json({ id: recapRef.id });
}
