import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';
import { Timestamp } from 'firebase-admin/firestore';

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
// Menipis = stok masih ada tapi sudah di batas minimum — sama seperti isLowStock di MaterialsTab.
const isMaterialLowStock = (m: MaterialDoc) => (m.minStock ?? 0) > 0 && (m.stockQty ?? 0) > 0 && (m.stockQty ?? 0) <= (m.minStock ?? 0);

// Raw Firestore reads untuk satu rentang tanggal — cached 60s karena endpoint ini dipanggil tiap
// dashboard dibuka & tiap ganti periode, dan tidak butuh data second-fresh untuk sebuah ringkasan
// tren. createdAt dikonversi ke detik (number) di sini, bukan dibiarkan sebagai Timestamp, supaya
// aman di-serialize oleh unstable_cache dan konsisten dengan pola route lain (orders, consignment).
const getRawAnalytics = unstable_cache(
  async (from: string, to: string) => {
    const db = getDb();
    const [orderSnap, recapSnap, incomeSnap, expenseSnap, materialSnap, productSnap] = await Promise.all([
      db.collection('orders')
        .where('createdAt', '>=', wibDayStart(from)).where('createdAt', '<=', wibDayEnd(to)).get(),
      db.collection('consignmentRecaps')
        .where('createdAt', '>=', wibDayStart(from)).where('createdAt', '<=', wibDayEnd(to)).get(),
      db.collection('income').where('date', '>=', from).where('date', '<=', to).get(),
      db.collection('expenses').where('date', '>=', from).where('date', '<=', to).get(),
      db.collection('rawMaterials').get(),
      db.collection('products').get(),
    ]);

    const toSeconds = (ts: unknown) => ts instanceof Timestamp ? ts.seconds : null;

    return {
      orders: orderSnap.docs.map(d => {
        const data = d.data();
        return { ...data, createdAtSeconds: toSeconds(data.createdAt) } as OrderDoc;
      }),
      recaps: recapSnap.docs.map(d => {
        const data = d.data();
        return { ...data, createdAtSeconds: toSeconds(data.createdAt) } as RecapDoc;
      }),
      income: incomeSnap.docs.map(d => d.data() as IncomeDoc),
      expenses: expenseSnap.docs.map(d => d.data() as ExpenseDoc),
      materials: materialSnap.docs.map(d => ({ id: d.id, ...d.data() }) as MaterialDoc),
      productCosts: productSnap.docs.map(d => [d.id, Number(d.data().costPrice) || 0] as const),
    };
  },
  ['admin-analytics-overview'],
  { revalidate: 60 }
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
  // masuk, dan pesanan portal yang masih "baru" (belum dikonfirmasi) belum dihitung sebagai omzet ──
  const countedOrders = orders.filter(o => (o.source !== 'portal' || o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
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
    expenseByCategory: [...expenseByCategoryMap.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    incomeByCategory: [...incomeByCategoryMap.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    materials: { totalValue: totalMaterialValue, count: materials.length, lowStockCount, topByValue },
    dailyTrend,
  });
}
