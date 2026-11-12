import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';

interface OrderItemDoc { productId?: string; name?: string; qty: number; price?: number; subtotal?: number; costPrice?: number }
interface OrderDoc {
  isFree?: boolean; source?: 'kasir' | 'portal'; status?: string; paymentStatus?: 'lunas' | 'belum_lunas'; items?: OrderItemDoc[];
  subtotal?: number; total?: number; createdAtSeconds: number | null;
  // Porsi pesanan yang sudah dibayar (0..1): lunas = 1, belum lunas tanpa cicilan = 0, pesanan ber-cicilan =
  // total cicilan ÷ total pesanan (proporsional, sama seperti Laporan Keuangan). Dipakai mengalikan qty/omzet/HPP.
  paidFraction: number;
}
interface RecapItemDoc { productId?: string; productName?: string; qtySold: number; revenue?: number; hargaTitip?: number; costPrice?: number }
interface RecapDoc { paymentStatus?: 'lunas' | 'belum_lunas'; items?: RecapItemDoc[]; createdAtSeconds: number | null }

interface ProductRow {
  key: string; productId: string; name: string;
  qtyPos: number; qtyOnline: number; qtyConsignment: number;
  revenue: number; cogs: number;
  qtyFree: number; cogsFree: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

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

// Raw Firestore reads untuk satu rentang tanggal — cached 3 menit, sama seperti getRawAnalytics
// di analytics/overview/route.ts, supaya ganti-ganti periode/refresh di Laporan Produk tidak
// query Firestore fresh tiap kali (endpoint ini dulu tidak di-cache sama sekali).
const getRawProductReport = unstable_cache(
  async (from: string, to: string) => {
    const sql = getSql();
    const [orderRows, recapRows, productRows] = await Promise.all([
      // `orders` pindah ke Postgres (Tahap 12 migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md).
      sql<{ source: string; status: string; payment_status: string; items: unknown; subtotal: string; total: string; is_free: boolean | null; created_at: Date; paid_sum: string; pay_n: string }[]>`
        select o.source, o.status, o.payment_status, o.items, o.subtotal, o.total, o.is_free, o.created_at,
          (select coalesce(sum(p.amount), 0) from order_payments p where p.order_id = o.id) as paid_sum,
          (select count(*) from order_payments p where p.order_id = o.id) as pay_n
        from orders o
        where o.created_at >= ${wibDayStart(from).toDate()} and o.created_at <= ${wibDayEnd(to).toDate()}
      `,
      // `consignment_recaps` pindah ke Postgres (Tahap 13 migrasi Fase 2).
      sql<{ payment_status: string; items: unknown; created_at: Date }[]>`
        select payment_status, items, created_at from consignment_recaps
        where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
      `,
      sql<{ id: string; cost_price: string | null; bg_color: string | null }[]>`select id, cost_price, bg_color from products`,
    ]);
    return {
      productCosts: productRows.map(r => [r.id, r.cost_price != null ? Number(r.cost_price) : 0] as const),
      productColors: productRows.map(r => [r.id, r.bg_color] as const),
      orders: orderRows.map((r): OrderDoc => {
        const total = Number(r.total);
        const paidFraction = Number(r.pay_n) > 0
          ? (total > 0 ? Math.min(1, Number(r.paid_sum) / total) : 0)
          : (r.payment_status === 'lunas' ? 1 : 0);
        return {
          source: r.source as 'kasir' | 'portal', status: r.status, paymentStatus: r.payment_status as 'lunas' | 'belum_lunas',
          items: (parseJsonb(r.items) as OrderDoc['items']) ?? [],
          subtotal: Number(r.subtotal), total, isFree: r.is_free === true,
          createdAtSeconds: Math.floor(r.created_at.getTime() / 1000), paidFraction,
        };
      }),
      recaps: recapRows.map((r): RecapDoc => ({
        paymentStatus: r.payment_status as 'lunas' | 'belum_lunas',
        items: (parseJsonb(r.items) as RecapDoc['items']) ?? [],
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
      })),
    };
  },
  ['admin-analytics-product-report'],
  { revalidate: 180, tags: ['admin-analytics'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) {
    return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  }

  const { orders, recaps, productCosts, productColors } = await getRawProductReport(from, to);
  const productCostMap = new Map(productCosts);
  const productColorMap = new Map(productColors);
  // HPP — pakai costPrice snapshot saat transaksi; fallback ke Harga Modal produk terkini kalau
  // snapshot 0/kosong (transaksi lama). Sama seperti analytics/overview.
  const effectiveCost = (stored: number | undefined, productId: string | undefined) =>
    stored ? stored : (productId ? (productCostMap.get(productId) ?? 0) : 0);

  // Sama seperti Laporan Keuangan: order/rekap "Belum Lunas" atau yang belum dikonfirmasi
  // (pesanan "baru"/dibatalkan) tidak dihitung sebagai penjualan. Pesanan yang dicicil dihitung
  // PROPORSIONAL terhadap uang yang sudah masuk (paidFraction), tetap di tanggal transaksinya;
  // sisanya muncul di kartu "HPP Belum Closing > Belum dibayar" (lihat /api/closings/pending).
  const countedOrders = orders.filter(o => (o.status !== 'baru') && o.status !== 'dibatalkan' && o.paidFraction > 0);
  const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');

  const keyOf = (productId: string | undefined, name: string | undefined) => productId || `__noid__${name ?? '(tanpa nama)'}`;
  const rows = new Map<string, ProductRow>();
  const rowFor = (productId: string | undefined, name: string | undefined): ProductRow => {
    const key = keyOf(productId, name);
    let r = rows.get(key);
    if (!r) {
      r = { key, productId: productId ?? '', name: name || '(tanpa nama)', qtyPos: 0, qtyOnline: 0, qtyConsignment: 0, revenue: 0, cogs: 0, qtyFree: 0, cogsFree: 0 };
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
    byProduct.set(key, r2((byProduct.get(key) ?? 0) + qty));
  };

  countedOrders.forEach(o => {
    // Diskon di POS dipotong dari TOTAL order, bukan dari subtotal tiap item — prorata di sini
    // (scale = total / subtotal) supaya jumlah omzet per produk tetap identik dengan
    // "Penjualan Kasir/Online" di Laporan Keuangan (yang pakai order.total, sudah net diskon).
    const itemsSubtotal = (o.items ?? []).reduce((s, it) => s + (it.subtotal ?? (it.price ?? 0) * it.qty), 0);
    const scale = (o.total != null && itemsSubtotal > 0) ? o.total / itemsSubtotal : 1;
    // Transaksi yang ditandai Gratis di Kasir (bukan diskon): qty & HPP-nya dilacak terpisah.
    const isFree = o.isFree === true;
    const f = o.paidFraction;
    (o.items ?? []).forEach(it => {
      // Item bebas input di POS (mis. "Ongkir JNE", "Bungkus kado") tidak punya productId —
      // sama seperti /api/orders yang skip pemotongan stok & HPP untuk item ini, laporan produk
      // juga harus skip supaya item non-produk ini tidak nyasar jadi baris produk.
      if (!it.productId) return;
      const r = rowFor(it.productId, it.name);
      if (o.source === 'portal') r.qtyOnline += it.qty * f; else r.qtyPos += it.qty * f;
      r.revenue += (it.subtotal ?? (it.price ?? 0) * it.qty) * scale * f;
      const itemCogs = it.qty * effectiveCost(it.costPrice, it.productId) * f;
      // Barang gratis: omzetnya Rp0, jadi HPP-nya TIDAK dihitung ke Total HPP produk (laba kotor tidak
      // jadi negatif). Nilai HPP-nya tetap dicatat terpisah di cogsFree sebagai informasi.
      if (isFree) { r.qtyFree += it.qty * f; r.cogsFree += itemCogs; } else { r.cogs += itemCogs; }
      addDaily(o.createdAtSeconds, r.key, it.qty * f);
    });
  });
  countedRecaps.forEach(rec => {
    (rec.items ?? []).forEach(it => {
      const r = rowFor(it.productId, it.productName);
      r.qtyConsignment += it.qtySold;
      r.revenue += it.revenue ?? (it.hargaTitip ?? 0) * it.qtySold;
      r.cogs += it.qtySold * effectiveCost(it.costPrice, it.productId);
      addDaily(rec.createdAtSeconds, r.key, it.qtySold);
    });
  });

  const products = [...rows.values()]
    // Math.round karena prorata diskon di atas menghasilkan pecahan rupiah.
    // qty bisa pecahan (cicilan proporsional) — dibulatkan 2 desimal supaya tidak muncul ekor floating point.
    .map(r => {
      const qtyPos = r2(r.qtyPos), qtyOnline = r2(r.qtyOnline), qtyConsignment = r2(r.qtyConsignment);
      return { ...r, qtyPos, qtyOnline, qtyConsignment, qtyFree: r2(r.qtyFree), revenue: Math.round(r.revenue), cogs: Math.round(r.cogs), cogsFree: Math.round(r.cogsFree), qtyTotal: r2(qtyPos + qtyOnline + qtyConsignment) };
    })
    .filter(r => r.qtyTotal > 0)
    .sort((a, b) => b.qtyTotal - a.qtyTotal);

  const totalQty = r2(products.reduce((s, p) => s + p.qtyTotal, 0));
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
  const totalCogs = products.reduce((s, p) => s + p.cogs, 0);
  const totalQtyFree = r2(products.reduce((s, p) => s + p.qtyFree, 0));
  const totalCogsFree = products.reduce((s, p) => s + p.cogsFree, 0);

  // Grafik tren — dibatasi ke 4 produk terlaris supaya tetap terbaca (bukan spaghetti chart) dan
  // warnanya bisa dipetakan tetap 1:1 per produk di client (lihat ProductReportTab).
  const trendProducts = products.slice(0, 4).map(p => ({ key: p.key, name: p.name, color: productColorMap.get(p.productId) ?? null }));
  const dailyTrend = eachDay(from, to).map(date => {
    const byProduct = dailyQty.get(date);
    const row: Record<string, string | number> = { date };
    trendProducts.forEach(p => { row[p.key] = byProduct?.get(p.key) ?? 0; });
    return row;
  });

  return Response.json({ period: { from, to }, products, totalQty, totalRevenue, totalCogs, totalQtyFree, totalCogsFree, trendProducts, dailyTrend });
}
