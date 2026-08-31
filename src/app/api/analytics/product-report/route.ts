import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';

interface OrderItemDoc { productId?: string; name?: string; qty: number; price?: number; subtotal?: number }
interface OrderDoc { source?: 'kasir' | 'portal'; status?: string; paymentStatus?: 'lunas' | 'belum_lunas'; items?: OrderItemDoc[] }
interface RecapItemDoc { productId?: string; productName?: string; qtySold: number; revenue?: number; hargaTitip?: number }
interface RecapDoc { paymentStatus?: 'lunas' | 'belum_lunas'; items?: RecapItemDoc[] }

interface ProductRow {
  productId: string; name: string;
  qtyPos: number; qtyOnline: number; qtyConsignment: number;
  revenue: number;
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) {
    return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  }

  const db = getDb();
  const [orderSnap, recapSnap] = await Promise.all([
    db.collection('orders')
      .where('createdAt', '>=', wibDayStart(from)).where('createdAt', '<=', wibDayEnd(to)).get(),
    db.collection('consignmentRecaps')
      .where('createdAt', '>=', wibDayStart(from)).where('createdAt', '<=', wibDayEnd(to)).get(),
  ]);
  const orders = orderSnap.docs.map(d => d.data() as OrderDoc);
  const recaps = recapSnap.docs.map(d => d.data() as RecapDoc);

  // Sama seperti Laporan Keuangan: order/rekap "Belum Lunas" atau yang belum dikonfirmasi
  // (pesanan "baru"/dibatalkan) tidak dihitung sebagai penjualan.
  const countedOrders = orders.filter(o => (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
  const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');

  const rows = new Map<string, ProductRow>();
  const rowFor = (productId: string | undefined, name: string | undefined): ProductRow => {
    const key = productId || `__noid__${name ?? '(tanpa nama)'}`;
    let r = rows.get(key);
    if (!r) {
      r = { productId: productId ?? '', name: name || '(tanpa nama)', qtyPos: 0, qtyOnline: 0, qtyConsignment: 0, revenue: 0 };
      rows.set(key, r);
    }
    return r;
  };

  countedOrders.forEach(o => {
    (o.items ?? []).forEach(it => {
      const r = rowFor(it.productId, it.name);
      if (o.source === 'portal') r.qtyOnline += it.qty; else r.qtyPos += it.qty;
      r.revenue += it.subtotal ?? (it.price ?? 0) * it.qty;
    });
  });
  countedRecaps.forEach(rec => {
    (rec.items ?? []).forEach(it => {
      const r = rowFor(it.productId, it.productName);
      r.qtyConsignment += it.qtySold;
      r.revenue += it.revenue ?? (it.hargaTitip ?? 0) * it.qtySold;
    });
  });

  const products = [...rows.values()]
    .map(r => ({ ...r, qtyTotal: r.qtyPos + r.qtyOnline + r.qtyConsignment }))
    .filter(r => r.qtyTotal > 0)
    .sort((a, b) => b.qtyTotal - a.qtyTotal);

  const totalQty = products.reduce((s, p) => s + p.qtyTotal, 0);
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);

  return Response.json({ period: { from, to }, products, totalQty, totalRevenue });
}
