import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';
import { Timestamp } from 'firebase-admin/firestore';

interface LocationDoc { id: string; name?: string; code?: string }
interface ShipmentDoc {
  locationId?: string; locationName?: string; createdAtSeconds: number | null;
  items?: { productId?: string; productName?: string; qty: number; subtotal?: number }[];
}
interface RecapDoc {
  locationId?: string; locationName?: string; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAtSeconds: number | null;
  totalSold?: number; totalRetur?: number; totalReject?: number; totalRevenue?: number;
  items?: { productId?: string; productName?: string; qtySold: number; revenue?: number }[];
}
interface StockDoc { locationId?: string; productId?: string; stockQty?: number; hargaTitip?: number }

// Sama seperti /api/analytics/overview — dipakai baik oleh tab Mitra (izin `consignment`) maupun
// halaman Analitik utama (izin `dashboard`), jadi OR-gate keduanya (mengikuti pola
// CONSIGNMENT_RECAP_VIEW_KEYS di lib/permissions.ts) supaya satu endpoint bisa dipakai kedua tempat.
const CONSIGNMENT_ANALYTICS_VIEW_KEYS = ['consignment', 'dashboard'];

// Raw Firestore reads untuk satu rentang tanggal — cached 3 menit, pola sama dengan
// getRawAnalytics di /api/analytics/overview.
const getRawConsignmentAnalytics = unstable_cache(
  async (from: string, to: string) => {
    const db = getDb();
    const sql = getSql();
    const [locRows, shipSnap, recapRows, stockRows] = await Promise.all([
      sql<{ id: string; name: string; code: string | null }[]>`select id, name, code from consignment_locations`,
      db.collection('consignmentShipments')
        .where('createdAt', '>=', wibDayStart(from)).where('createdAt', '<=', wibDayEnd(to)).get(),
      // `consignment_recaps` pindah ke Postgres (Tahap 13 migrasi Fase 2).
      sql<{ location_id: string; location_name: string; payment_status: string; created_at: Date; total_sold: string; total_retur: string; total_reject: string; total_revenue: string; items: unknown }[]>`
        select location_id, location_name, payment_status, created_at, total_sold, total_retur, total_reject, total_revenue, items
        from consignment_recaps
        where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
      `,
      sql<{ location_id: string | null; product_id: string | null; stock_qty: string; harga_titip: string | null }[]>`
        select location_id, product_id, stock_qty, harga_titip from consignment_stock
      `,
    ]);

    const toSeconds = (ts: unknown) => ts instanceof Timestamp ? ts.seconds : null;

    return {
      locations: locRows.map(r => ({ id: r.id, name: r.name, code: r.code ?? undefined }) as LocationDoc),
      shipments: shipSnap.docs.map(d => {
        const data = d.data();
        return { ...data, createdAtSeconds: toSeconds(data.createdAt) } as ShipmentDoc;
      }),
      recaps: recapRows.map((r): RecapDoc => ({
        locationId: r.location_id, locationName: r.location_name,
        paymentStatus: r.payment_status as 'lunas' | 'belum_lunas',
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
        totalSold: Number(r.total_sold), totalRetur: Number(r.total_retur),
        totalReject: Number(r.total_reject), totalRevenue: Number(r.total_revenue),
        items: (parseJsonb(r.items) as RecapDoc['items']) ?? [],
      })),
      stock: stockRows.map(r => ({
        locationId: r.location_id ?? undefined, productId: r.product_id ?? undefined,
        stockQty: Number(r.stock_qty) || 0, hargaTitip: r.harga_titip != null ? Number(r.harga_titip) : 0,
      }) as StockDoc),
    };
  },
  ['admin-analytics-consignment'],
  { revalidate: 180 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, CONSIGNMENT_ANALYTICS_VIEW_KEYS, 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) {
    return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  }

  const { locations, shipments, recaps, stock } = await getRawConsignmentAnalytics(from, to);

  const locationName = new Map(locations.map(l => [l.id, l.name ?? '(Lokasi dihapus)']));
  const locationCode = new Map(locations.map(l => [l.id, l.code ?? '']));

  // ── Stok saat ini (snapshot terkini, bukan per-periode) ──
  const stockValue = stock.reduce((s, r) => s + (r.stockQty ?? 0) * (r.hargaTitip ?? 0), 0);
  const stockCount = stock.filter(r => (r.stockQty ?? 0) > 0).length;
  const stockValueByLocation = new Map<string, number>();
  stock.forEach(r => {
    if (!r.locationId) return;
    stockValueByLocation.set(r.locationId, (stockValueByLocation.get(r.locationId) ?? 0) + (r.stockQty ?? 0) * (r.hargaTitip ?? 0));
  });

  // ── Agregasi per lokasi — kirim (nilai titip dikirim), pendapatan (rekap terjual), jual/retur/reject ──
  interface LocAgg {
    kirim: number; kirimQty: number; pendapatan: number; jual: number; retur: number; reject: number;
    lunasAmount: number; belumLunasAmount: number; lunasCount: number; belumLunasCount: number;
  }
  const locAgg = new Map<string, LocAgg>();
  const getLocAgg = (id: string): LocAgg => {
    let a = locAgg.get(id);
    if (!a) { a = { kirim: 0, kirimQty: 0, pendapatan: 0, jual: 0, retur: 0, reject: 0, lunasAmount: 0, belumLunasAmount: 0, lunasCount: 0, belumLunasCount: 0 }; locAgg.set(id, a); }
    return a;
  };

  shipments.forEach(s => {
    if (!s.locationId) return;
    const a = getLocAgg(s.locationId);
    a.kirim += (s.items ?? []).reduce((sum, it) => sum + (it.subtotal ?? 0), 0);
    a.kirimQty += (s.items ?? []).reduce((sum, it) => sum + (it.qty ?? 0), 0);
  });

  const productAgg = new Map<string, { productId: string; productName: string; qtySold: number; revenue: number }>();
  recaps.forEach(r => {
    if (!r.locationId) return;
    const a = getLocAgg(r.locationId);
    a.pendapatan += r.totalRevenue ?? 0;
    a.jual += r.totalSold ?? 0;
    a.retur += r.totalRetur ?? 0;
    a.reject += r.totalReject ?? 0;
    if (r.paymentStatus === 'belum_lunas') { a.belumLunasAmount += r.totalRevenue ?? 0; a.belumLunasCount += 1; }
    else { a.lunasAmount += r.totalRevenue ?? 0; a.lunasCount += 1; }

    (r.items ?? []).forEach(it => {
      if (!it.productId) return;
      let p = productAgg.get(it.productId);
      if (!p) { p = { productId: it.productId, productName: it.productName ?? '', qtySold: 0, revenue: 0 }; productAgg.set(it.productId, p); }
      p.qtySold += it.qtySold ?? 0;
      p.revenue += it.revenue ?? 0;
    });
  });

  const topLocations = [...locAgg.entries()]
    .map(([id, a]) => {
      const totalUnits = a.jual + a.retur + a.reject;
      return {
        id, name: locationName.get(id) ?? '(Lokasi dihapus)', code: locationCode.get(id) ?? '',
        kirim: a.kirim, kirimQty: a.kirimQty, pendapatan: a.pendapatan, selisih: a.kirim - a.pendapatan,
        sellThroughPct: totalUnits > 0 ? Math.round((a.jual / totalUnits) * 1000) / 10 : 0,
        jual: a.jual, retur: a.retur, reject: a.reject,
        stockValue: stockValueByLocation.get(id) ?? 0,
        lunasAmount: a.lunasAmount, belumLunasAmount: a.belumLunasAmount,
      };
    })
    .sort((a, b) => b.pendapatan - a.pendapatan);

  const topProducts = [...productAgg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  const totalKirim = topLocations.reduce((s, l) => s + l.kirim, 0);
  const totalKirimQty = topLocations.reduce((s, l) => s + l.kirimQty, 0);
  const totalPendapatan = topLocations.reduce((s, l) => s + l.pendapatan, 0);
  const totalJual = topLocations.reduce((s, l) => s + l.jual, 0);
  const totalRetur = topLocations.reduce((s, l) => s + l.retur, 0);
  const totalReject = topLocations.reduce((s, l) => s + l.reject, 0);
  const totalUnitsAll = totalJual + totalRetur + totalReject;
  const totalLunasAmount = topLocations.reduce((s, l) => s + l.lunasAmount, 0);
  const totalBelumLunasAmount = topLocations.reduce((s, l) => s + l.belumLunasAmount, 0);
  const totalLunasCount = [...locAgg.values()].reduce((s, a) => s + a.lunasCount, 0);
  const totalBelumLunasCount = [...locAgg.values()].reduce((s, a) => s + a.belumLunasCount, 0);

  // ── Tren harian — kirim vs pendapatan, bucket hari kalender WIB ──
  interface DayBucket { kirim: number; pendapatan: number }
  const dailyMap = new Map<string, DayBucket>();
  const bucket = (key: string): DayBucket => {
    let b = dailyMap.get(key);
    if (!b) { b = { kirim: 0, pendapatan: 0 }; dailyMap.set(key, b); }
    return b;
  };
  shipments.forEach(s => {
    if (s.createdAtSeconds == null) return;
    bucket(wibDateKey(new Date(s.createdAtSeconds * 1000))).kirim += (s.items ?? []).reduce((sum, it) => sum + (it.subtotal ?? 0), 0);
  });
  recaps.forEach(r => {
    if (r.createdAtSeconds == null) return;
    bucket(wibDateKey(new Date(r.createdAtSeconds * 1000))).pendapatan += r.totalRevenue ?? 0;
  });
  const dailyTrend = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => ({ date, ...b }));

  return Response.json({
    period: { from, to },
    summary: {
      totalPartners: locations.length,
      totalKirim, totalPendapatan, totalSelisih: totalKirim - totalPendapatan,
      sellThroughPct: totalUnitsAll > 0 ? Math.round((totalJual / totalUnitsAll) * 1000) / 10 : 0,
      totalKirimQty, totalJual, totalRetur, totalReject, totalUnitsAll,
      stockValue, stockCount,
      lunas: { count: totalLunasCount, amount: totalLunasAmount },
      belumLunas: { count: totalBelumLunasCount, amount: totalBelumLunasAmount },
    },
    topLocations,
    topProducts,
    paymentStatus: [
      { status: 'lunas' as const, label: 'Lunas', count: totalLunasCount, amount: totalLunasAmount },
      { status: 'belum_lunas' as const, label: 'Belum Lunas', count: totalBelumLunasCount, amount: totalBelumLunasAmount },
    ],
    dailyTrend,
  });
}
