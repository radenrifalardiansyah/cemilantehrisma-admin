import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';
import { Timestamp } from 'firebase-admin/firestore';

interface OrderItemDoc { productId?: string; name?: string; qty: number; price?: number; subtotal?: number }
interface OrderDoc {
  source?: 'kasir' | 'portal'; status?: string; paymentStatus?: 'lunas' | 'belum_lunas'; items?: OrderItemDoc[];
  subtotal?: number; total?: number; createdAtSeconds: number | null;
}
interface RecapItemDoc { productId?: string; productName?: string; qtySold: number; revenue?: number; hargaTitip?: number }
interface RecapDoc { paymentStatus?: 'lunas' | 'belum_lunas'; items?: RecapItemDoc[]; createdAtSeconds: number | null }

interface ProductRow {
  key: string; productId: string; name: string;
  qtyPos: number; qtyOnline: number; qtyConsignment: number;
  revenue: number;
}

// Semua tanggal kalender dari `from` s/d `to` (inklusif) — dipakai supaya sumbu tanggal grafik tren
// tidak bolong di hari tanpa transaksi (beda dari dailyTrend di analytics/overview yang cuma
// mencatat hari yang ada aktivitasnya).
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return days;
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
  const toSeconds = (ts: unknown) => ts instanceof Timestamp ? ts.seconds : null;
  const orders = orderSnap.docs.map(d => {
    const data = d.data();
    return { ...data, createdAtSeconds: toSeconds(data.createdAt) } as OrderDoc;
  });
  const recaps = recapSnap.docs.map(d => {
    const data = d.data();
    return { ...data, createdAtSeconds: toSeconds(data.createdAt) } as RecapDoc;
  });

  // Sama seperti Laporan Keuangan: order/rekap "Belum Lunas" atau yang belum dikonfirmasi
  // (pesanan "baru"/dibatalkan) tidak dihitung sebagai penjualan.
  const countedOrders = orders.filter(o => (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
  const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');

  const keyOf = (productId: string | undefined, name: string | undefined) => productId || `__noid__${name ?? '(tanpa nama)'}`;
  const rows = new Map<string, ProductRow>();
  const rowFor = (productId: string | undefined, name: string | undefined): ProductRow => {
    const key = keyOf(productId, name);
    let r = rows.get(key);
    if (!r) {
      r = { key, productId: productId ?? '', name: name || '(tanpa nama)', qtyPos: 0, qtyOnline: 0, qtyConsignment: 0, revenue: 0 };
      rows.set(key, r);
    }
    return r;
  };

  // Qty per hari (WIB) per produk — dipakai grafik tren, dibatasi ke top 4 produk sesudah
  // agregasi total selesai (lihat trendProducts di bawah), supaya payload-nya tetap kecil.
  const dailyQty = new Map<string, Map<string, number>>();
  const addDaily = (seconds: number | null, key: string, qty: number) => {
    if (seconds == null) return;
    const dayKey = wibDateKey(new Date(seconds * 1000));
    let byProduct = dailyQty.get(dayKey);
    if (!byProduct) { byProduct = new Map(); dailyQty.set(dayKey, byProduct); }
    byProduct.set(key, (byProduct.get(key) ?? 0) + qty);
  };

  countedOrders.forEach(o => {
    // Diskon di POS dipotong dari TOTAL order, bukan dari subtotal tiap item — prorata di sini
    // (scale = total / subtotal) supaya jumlah omzet per produk tetap identik dengan
    // "Penjualan Kasir/Online" di Laporan Keuangan (yang pakai order.total, sudah net diskon).
    const itemsSubtotal = (o.items ?? []).reduce((s, it) => s + (it.subtotal ?? (it.price ?? 0) * it.qty), 0);
    const scale = (o.total != null && itemsSubtotal > 0) ? o.total / itemsSubtotal : 1;
    (o.items ?? []).forEach(it => {
      const r = rowFor(it.productId, it.name);
      if (o.source === 'portal') r.qtyOnline += it.qty; else r.qtyPos += it.qty;
      r.revenue += (it.subtotal ?? (it.price ?? 0) * it.qty) * scale;
      addDaily(o.createdAtSeconds, r.key, it.qty);
    });
  });
  countedRecaps.forEach(rec => {
    (rec.items ?? []).forEach(it => {
      const r = rowFor(it.productId, it.productName);
      r.qtyConsignment += it.qtySold;
      r.revenue += it.revenue ?? (it.hargaTitip ?? 0) * it.qtySold;
      addDaily(rec.createdAtSeconds, r.key, it.qtySold);
    });
  });

  const products = [...rows.values()]
    // Math.round karena prorata diskon di atas menghasilkan pecahan rupiah.
    .map(r => ({ ...r, revenue: Math.round(r.revenue), qtyTotal: r.qtyPos + r.qtyOnline + r.qtyConsignment }))
    .filter(r => r.qtyTotal > 0)
    .sort((a, b) => b.qtyTotal - a.qtyTotal);

  const totalQty = products.reduce((s, p) => s + p.qtyTotal, 0);
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);

  // Grafik tren — dibatasi ke 4 produk terlaris supaya tetap terbaca (bukan spaghetti chart) dan
  // warnanya bisa dipetakan tetap 1:1 per produk di client (lihat ProductReportTab).
  const trendProducts = products.slice(0, 4).map(p => ({ key: p.key, name: p.name }));
  const dailyTrend = eachDay(from, to).map(date => {
    const byProduct = dailyQty.get(date);
    const row: Record<string, string | number> = { date };
    trendProducts.forEach(p => { row[p.key] = byProduct?.get(p.key) ?? 0; });
    return row;
  });

  return Response.json({ period: { from, to }, products, totalQty, totalRevenue, trendProducts, dailyTrend });
}
