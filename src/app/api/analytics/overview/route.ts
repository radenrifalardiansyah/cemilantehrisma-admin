import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';
import { isMaterialLowStock } from '@/lib/stock-helpers';

interface OrderDoc {
  total?: number; source?: 'kasir' | 'portal'; status?: string; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAtSeconds: number | null;
  items?: { productId?: string; qty: number; costPrice?: number }[];
}
interface RecapDoc {
  totalRevenue?: number; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAtSeconds: number | null;
  items?: { productId?: string; qtySold: number; costPrice?: number }[];
}
interface IncomeDoc { category?: string; amount?: number; date?: string }
interface ExpenseDoc { category?: string; amount?: number; date?: string; sourceType?: string }
interface MaterialDoc { id: string; name?: string; unit?: string; stockQty?: number; avgCost?: number; minStock?: number }

// Beban yang otomatis tercatat dari Pembelian Bahan Baku / Produksi sudah masuk HPP saat barangnya
// terjual — sama seperti FinanceReportTab, jangan dihitung lagi di Beban Operasional (dobel).
const isCogsSourcedExpense = (e: ExpenseDoc) => e.sourceType === 'material-purchase' || e.sourceType === 'production';

// Raw Firestore reads untuk satu rentang tanggal — cached 3 menit karena endpoint ini dipanggil
// tiap dashboard dibuka & tiap ganti periode, dan tidak butuh data second-fresh untuk sebuah
// ringkasan tren. createdAt dikonversi ke detik (number) di sini, bukan dibiarkan sebagai
// Timestamp, supaya aman di-serialize oleh unstable_cache dan konsisten dengan pola route lain
// (orders, consignment).
const getRawAnalytics = unstable_cache(
  async (from: string, to: string) => {
    const db = getDb();
    const sql = getSql();
    const [orderRows, recapRows, incomeRows, expenseRows, materialSnap, productRows] = await Promise.all([
      // `orders` pindah ke Postgres (Tahap 12 migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md).
      sql<{ total: string; source: string; status: string; payment_status: string; created_at: Date; items: unknown }[]>`
        select total, source, status, payment_status, created_at, items from orders
        where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
      `,
      // `consignment_recaps` pindah ke Postgres (Tahap 13 migrasi Fase 2).
      sql<{ total_revenue: string; payment_status: string; created_at: Date; items: unknown }[]>`
        select total_revenue, payment_status, created_at, items from consignment_recaps
        where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
      `,
      // income pindah ke Postgres (Tahap 4 migrasi)
      sql<{ category: string | null; amount: string; date: string }[]>`
        select category, amount, date from income where date >= ${from} and date <= ${to}
      `,
      // expenses pindah ke Postgres (Tahap 5 migrasi)
      sql<{ category: string | null; amount: string; date: string; source_type: string | null }[]>`
        select category, amount, date, source_type from expenses where date >= ${from} and date <= ${to}
      `,
      db.collection('rawMaterials').get(),
      sql<{ id: string; cost_price: string | null }[]>`select id, cost_price from products`,
    ]);

    return {
      orders: orderRows.map((r): OrderDoc => ({
        total: Number(r.total), source: r.source as 'kasir' | 'portal', status: r.status,
        paymentStatus: r.payment_status as 'lunas' | 'belum_lunas',
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
        items: (parseJsonb(r.items) as OrderDoc['items']) ?? [],
      })),
      recaps: recapRows.map((r): RecapDoc => ({
        totalRevenue: Number(r.total_revenue), paymentStatus: r.payment_status as 'lunas' | 'belum_lunas',
        createdAtSeconds: Math.floor(r.created_at.getTime() / 1000),
        items: (parseJsonb(r.items) as RecapDoc['items']) ?? [],
      })),
      income: incomeRows.map(r => ({ category: r.category ?? undefined, amount: Number(r.amount), date: r.date }) as IncomeDoc),
      expenses: expenseRows.map(r => ({ category: r.category ?? undefined, amount: Number(r.amount), date: r.date, sourceType: r.source_type ?? undefined }) as ExpenseDoc),
      materials: materialSnap.docs.map(d => ({ id: d.id, ...d.data() }) as MaterialDoc),
      productCosts: productRows.map(r => [r.id, r.cost_price != null ? Number(r.cost_price) : 0] as const),
    };
  },
  ['admin-analytics-overview'],
  { revalidate: 180 }
);

// Saldo kas riil sejak awal pencatatan — independen dari filter periode di atas, sama seperti
// "Saldo Kas Saat Ini" di FinanceReportTab. Query terpisah (bukan ikut getRawAnalytics) karena
// tidak butuh direfetch tiap ganti periode dashboard, cukup di-cache sendiri.
//
// Semua sumber (capitalEntries, income, expenses, orders & consignment_recaps — Tahap 2, 4, 5,
// 12 & 13 migrasi) sudah di Postgres, diagregat langsung di SQL. Tetap di-cache 10 menit (bukan
// dihitung tiap request) karena ini scan SELURUH riwayat tanpa batas tanggal, biayanya membesar
// seiring bertambahnya data — angka ringkasan dashboard, bukan penghitung real-time.
const getAllTimeCash = unstable_cache(
  async () => {
    const sql = getSql();
    const [totals] = await sql<{ total_modal: string; total_prive: string; total_income: string; total_expenses: string; total_orders: string; total_recaps: string }[]>`
      select
        coalesce((select sum(amount) filter (where type = 'modal') from capital_entries), 0) as total_modal,
        coalesce((select sum(amount) filter (where type = 'prive') from capital_entries), 0) as total_prive,
        coalesce((select sum(amount) from income), 0) as total_income,
        coalesce((select sum(amount) from expenses), 0) as total_expenses,
        coalesce((select sum(total) from orders where status != 'baru' and payment_status != 'belum_lunas' and status != 'dibatalkan'), 0) as total_orders,
        coalesce((select sum(total_revenue) from consignment_recaps where payment_status != 'belum_lunas'), 0) as total_recaps
    `;
    return {
      totalOrdersRevenue: Number(totals.total_orders) || 0,
      totalRecapsRevenue: Number(totals.total_recaps) || 0,
      totalIncome: Number(totals.total_income) || 0,
      totalExpenses: Number(totals.total_expenses) || 0,
      capital: { totalModal: Number(totals.total_modal) || 0, totalPrive: Number(totals.total_prive) || 0 },
    };
  },
  ['admin-analytics-alltime-cash'],
  { revalidate: 600 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'dashboard', 'view');
  if (guard instanceof Response) return guard;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) {
    return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  }

  const { orders, recaps, income, expenses, materials, productCosts } = await getRawAnalytics(from, to);
  const productCostMap = new Map(productCosts);

  // ── Sama persis dengan FinanceReportTab: order/rekap "Belum Lunas" tidak dihitung sebagai uang
  // masuk, dan pesanan yang masih "baru" (belum dikonfirmasi — online atau kasir berisi item
  // "Buka PO") belum dihitung sebagai omzet ──
  const countedOrders = orders.filter(o => (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
  const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');

  const posRevenue = countedOrders.filter(o => o.source !== 'portal').reduce((s, o) => s + (o.total ?? 0), 0);
  const onlineRevenue = countedOrders.filter(o => o.source === 'portal').reduce((s, o) => s + (o.total ?? 0), 0);
  const consignmentRevenue = countedRecaps.reduce((s, r) => s + (r.totalRevenue ?? 0), 0);
  const incomeLain = income.reduce((s, i) => s + (i.amount ?? 0), 0);
  const totalPendapatan = posRevenue + onlineRevenue + consignmentRevenue + incomeLain;

  // HPP — pakai costPrice snapshot tiap item kalau ada isinya, fallback ke Harga Modal produk
  // TERKINI kalau snapshot 0/kosong (transaksi lama sebelum Harga Modal-nya diisi).
  const effectiveCostPrice = (stored: number | undefined, productId: string | undefined) =>
    stored ? stored : (productId ? (productCostMap.get(productId) ?? 0) : 0);
  const hppPenjualan = countedOrders.reduce((s, o) =>
    s + (o.items ?? []).reduce((s2, it) => s2 + it.qty * effectiveCostPrice(it.costPrice, it.productId), 0), 0);
  const hppKonsinyasi = countedRecaps.reduce((s, r) =>
    s + (r.items ?? []).reduce((s2, it) => s2 + it.qtySold * effectiveCostPrice(it.costPrice, it.productId), 0), 0);
  const hpp = hppPenjualan + hppKonsinyasi;
  const labaKotor = totalPendapatan - hpp;

  const expensesOperasional = expenses.filter(e => !isCogsSourcedExpense(e));
  const totalBebanOperasional = expensesOperasional.reduce((s, e) => s + (e.amount ?? 0), 0);
  const labaBersih = labaKotor - totalBebanOperasional;

  const expenseByCategoryMap = new Map<string, number>();
  expenses.forEach(e => {
    const cat = e.category ?? 'Lainnya';
    expenseByCategoryMap.set(cat, (expenseByCategoryMap.get(cat) ?? 0) + (e.amount ?? 0));
  });
  const incomeByCategoryMap = new Map<string, number>();
  income.forEach(i => {
    const cat = i.category ?? 'Lainnya';
    incomeByCategoryMap.set(cat, (incomeByCategoryMap.get(cat) ?? 0) + (i.amount ?? 0));
  });

  // ── Saldo kas — snapshot sejak awal pencatatan (bukan per-periode), sama rumusnya dengan
  // loadAllTimeSaldo di FinanceReportTab ──
  const allTime = await getAllTimeCash();
  const allTimeTxSaldo =
    allTime.totalOrdersRevenue +
    allTime.totalRecapsRevenue +
    allTime.totalIncome +
    allTime.capital.totalModal -
    allTime.totalExpenses -
    allTime.capital.totalPrive;

  // ── Bahan baku — snapshot kondisi saat ini (bukan per-periode) ──
  const materialsWithValue = materials.map(m => ({
    id: m.id, name: m.name ?? '', unit: m.unit ?? '',
    stockQty: m.stockQty ?? 0, avgCost: m.avgCost ?? 0,
    value: (m.stockQty ?? 0) * (m.avgCost ?? 0),
  }));
  const totalMaterialValue = materialsWithValue.reduce((s, m) => s + m.value, 0);
  const lowStockCount = materials.filter(isMaterialLowStock).length;
  const topByValue = [...materialsWithValue].sort((a, b) => b.value - a.value).slice(0, 8);

  // ── Tren harian per channel — bucket pakai hari kalender WIB, bukan UTC, supaya tidak selisih
  // sehari di sekitar tengah malam (beda dari trendData lama di FinanceReportTab) ──
  interface DayBucket { online: number; pos: number; consignment: number; incomeLain: number; expense: number }
  const dailyMap = new Map<string, DayBucket>();
  const bucket = (key: string): DayBucket => {
    let b = dailyMap.get(key);
    if (!b) { b = { online: 0, pos: 0, consignment: 0, incomeLain: 0, expense: 0 }; dailyMap.set(key, b); }
    return b;
  };
  countedOrders.forEach(o => {
    if (o.createdAtSeconds == null) return;
    const b = bucket(wibDateKey(new Date(o.createdAtSeconds * 1000)));
    if (o.source === 'portal') b.online += o.total ?? 0; else b.pos += o.total ?? 0;
  });
  countedRecaps.forEach(r => {
    if (r.createdAtSeconds == null) return;
    bucket(wibDateKey(new Date(r.createdAtSeconds * 1000))).consignment += r.totalRevenue ?? 0;
  });
  income.forEach(i => { if (i.date) bucket(i.date).incomeLain += i.amount ?? 0; });
  expenses.forEach(e => { if (e.date) bucket(e.date).expense += e.amount ?? 0; });
  const dailyTrend = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => ({ date, ...b, pendapatan: b.online + b.pos + b.consignment + b.incomeLain }));

  return Response.json({
    period: { from, to },
    channels: { online: onlineRevenue, pos: posRevenue, consignment: consignmentRevenue, incomeLain, total: totalPendapatan },
    finance: { pendapatan: totalPendapatan, hpp, labaKotor, bebanOperasional: totalBebanOperasional, labaBersih },
    cash: { allTimeTx: allTimeTxSaldo },
    expenseByCategory: [...expenseByCategoryMap.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    incomeByCategory: [...incomeByCategoryMap.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    materials: { totalValue: totalMaterialValue, count: materials.length, lowStockCount, topByValue },
    dailyTrend,
  });
}
