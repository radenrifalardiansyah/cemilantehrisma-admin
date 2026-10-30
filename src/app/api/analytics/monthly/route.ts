import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';
import { stockAdjustmentForPeriod } from '@/lib/stock-adjustment-pg';
import { fetchInstallmentPayments, installmentRatio } from '@/lib/installment-payments-report';

// Penjualan & laba per BULAN untuk satu tahun / rentang periode (Dashboard → Analitik Bisnis).
// Aturan hitungnya sama persis dengan /api/analytics/overview (order "belum lunas"/"baru"/dibatalkan
// tidak dihitung, cicilan dihitung per tanggal bayar, HPP pakai snapshot costPrice dengan fallback
// Harga Modal produk, beban yang sumbernya pembelian bahan/produksi tidak dihitung lagi) — hanya
// dibucket per bulan kalender WIB. Maksimal 36 bulan sekali ambil.

interface OrderItem { productId?: string; qty: number; costPrice?: number }
interface MonthBucket {
  online: number; pos: number; consignment: number; incomeLain: number; hpp: number; beban: number;
}

const MAX_MONTHS = 36;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const monthOf = (dateKey: string) => dateKey.slice(0, 7);

function eachMonth(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const lastDay = (month: string) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return String(d.getUTCDate()).padStart(2, '0');
};

const compute = unstable_cache(
  async (from: string, to: string) => {
    const sql = getSql();
    const [orderRows, recapRows, incomeRows, expenseRows, productRows, installments] = await Promise.all([
      sql<{ total: string; source: string; status: string; payment_status: string; created_at: Date; items: unknown; has_payments: boolean }[]>`
        select total, source, status, payment_status, created_at, items, exists(select 1 from order_payments p where p.order_id = orders.id) as has_payments from orders
        where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
      `,
      sql<{ total_revenue: string; payment_status: string; created_at: Date; items: unknown }[]>`
        select total_revenue, payment_status, created_at, items from consignment_recaps
        where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
      `,
      sql<{ amount: string; date: string }[]>`select amount, date from income where date >= ${from} and date <= ${to}`,
      sql<{ amount: string; date: string; source_type: string | null; exclude_from_pnl: boolean | null }[]>`
        select amount, date, source_type, exclude_from_pnl from expenses where date >= ${from} and date <= ${to}
      `,
      sql<{ id: string; cost_price: string | null }[]>`select id, cost_price from products`,
      fetchInstallmentPayments(sql, from, to),
    ]);
    const costMap = new Map(productRows.map(r => [r.id, r.cost_price != null ? Number(r.cost_price) : 0]));
    const cost = (stored: number | undefined, productId: string | undefined) =>
      stored ? stored : (productId ? (costMap.get(productId) ?? 0) : 0);

    const months = eachMonth(from, to);
    const buckets = new Map<string, MonthBucket>(months.map(m => [m, { online: 0, pos: 0, consignment: 0, incomeLain: 0, hpp: 0, beban: 0 }]));
    const bk = (m: string) => buckets.get(m);

    for (const o of orderRows) {
      if (o.status === 'baru' || o.status === 'dibatalkan' || o.payment_status === 'belum_lunas' || o.has_payments) continue;
      const b = bk(monthOf(wibDateKey(o.created_at)));
      if (!b) continue;
      const total = Number(o.total) || 0;
      if (o.source === 'portal') b.online += total; else b.pos += total;
      b.hpp += ((parseJsonb(o.items) as OrderItem[]) ?? []).reduce((s, it) => s + it.qty * cost(it.costPrice, it.productId), 0);
    }
    for (const p of installments) {
      const b = bk(monthOf(wibDateKey(new Date(p.paidAtSeconds * 1000))));
      if (!b) continue;
      if (p.source === 'portal') b.online += p.amount; else b.pos += p.amount;
      b.hpp += installmentRatio(p) * p.items.reduce((s, it) => s + it.qty * cost(it.costPrice, it.productId), 0);
    }
    for (const r of recapRows) {
      if (r.payment_status === 'belum_lunas') continue;
      const b = bk(monthOf(wibDateKey(r.created_at)));
      if (!b) continue;
      b.consignment += Number(r.total_revenue) || 0;
      b.hpp += ((parseJsonb(r.items) as { productId?: string; qtySold: number; costPrice?: number }[]) ?? [])
        .reduce((s, it) => s + it.qtySold * cost(it.costPrice, it.productId), 0);
    }
    for (const i of incomeRows) { const b = bk(monthOf(i.date)); if (b) b.incomeLain += Number(i.amount) || 0; }
    for (const e of expenseRows) {
      if (e.source_type === 'material-purchase' || e.source_type === 'production' || e.exclude_from_pnl === true) continue;
      const b = bk(monthOf(e.date)); if (b) b.beban += Number(e.amount) || 0;
    }

    // Selisih stok opname per bulan (batas bulan dipotong ke from/to).
    const adjustments = await Promise.all(months.map(m => {
      const start = `${m}-01` < from ? from : `${m}-01`;
      const end = `${m}-${lastDay(m)}` > to ? to : `${m}-${lastDay(m)}`;
      return stockAdjustmentForPeriod(sql, start, end);
    }));

    return months.map((month, i) => {
      const b = buckets.get(month)!;
      const pendapatan = b.online + b.pos + b.consignment + b.incomeLain;
      const labaKotor = pendapatan - b.hpp;
      const selisihStok = adjustments[i].net;
      return {
        month, online: b.online, pos: b.pos, consignment: b.consignment, incomeLain: b.incomeLain,
        pendapatan, hpp: b.hpp, labaKotor, bebanOperasional: b.beban, selisihStok,
        labaBersih: labaKotor - b.beban + selisihStok,
      };
    });
  },
  ['admin-analytics-monthly'],
  { revalidate: 180, tags: ['admin-analytics'] },
);

export async function GET(req: NextRequest) {
  // Dipakai Dashboard (izin `dashboard`) dan Laporan Keuangan (izin `finance-report`).
  const guard = await requirePermission(req, ['dashboard', 'finance-report'], 'view');
  if (guard instanceof Response) return guard;

  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi dan from <= to.' }, { status: 400 });
  }
  if (eachMonth(from, to).length > MAX_MONTHS) {
    return Response.json({ error: `Maksimal ${MAX_MONTHS} bulan sekali tampil.` }, { status: 400 });
  }
  const months = await compute(from, to);
  return Response.json({ period: { from, to }, months });
}
