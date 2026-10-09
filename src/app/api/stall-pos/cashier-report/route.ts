import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { seq } from '@/lib/db-seq';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { toTimestamp } from '@/lib/orders-pg';
import { DATE_RE } from '@/lib/consign-settlement';

const num = (v: string | null | undefined) => Number(v ?? 0);

// Laporan penjualan per kasir lapak (menu Keuangan → Laporan). Satu laci bersama per lapak, tapi tiap
// transaksi mencatat kasirnya; di sini direkap per kasir + riwayat shift (siapa buka/tutup laci,
// selisih kas). Izin sendiri ('stall-sales-report'), terpisah dari Titip Jual/Kasir Lapak.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-sales-report', 'view');
  if (guard instanceof Response) return guard;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const stallId = sp.get('stallId') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return Response.json({ error: 'Periode tidak valid.' }, { status: 400 });

  const sql = getSql();
  const stallFilter = stallId ? sql`and s.stall_id = ${stallId}` : sql``;
  const shiftStallFilter = stallId ? sql`and sh.stall_id = ${stallId}` : sql``;

  const [stalls, totals, cashiers, shifts] = await seq([
    sql<{ id: string; name: string }[]>`select id, name from stalls order by name`,
    sql<{ n: string; revenue: string; discount: string }[]>`
      select count(*) as n, coalesce(sum(total - refund_total), 0) as revenue, coalesce(sum(discount), 0) as discount
      from stall_sales s where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallFilter}
    `,
    sql<{ cashier: string; n: string; revenue: string; discount: string; cash: string; qris: string; transfer: string; voids: string; void_amount: string }[]>`
      select coalesce(s.cashier, '-') as cashier,
             count(*) filter (where s.status = 'paid') as n,
             coalesce(sum(s.total - s.refund_total) filter (where s.status = 'paid'), 0) as revenue,
             coalesce(sum(s.discount) filter (where s.status = 'paid'), 0) as discount,
             coalesce(sum(s.total - s.refund_total) filter (where s.status = 'paid' and s.payment_method = 'cash'), 0) as cash,
             coalesce(sum(s.total - s.refund_total) filter (where s.status = 'paid' and s.payment_method = 'qris'), 0) as qris,
             coalesce(sum(s.total - s.refund_total) filter (where s.status = 'paid' and s.payment_method = 'transfer'), 0) as transfer,
             count(*) filter (where s.status = 'void') as voids,
             coalesce(sum(s.total) filter (where s.status = 'void'), 0) as void_amount
      from stall_sales s where s.date >= ${from} and s.date <= ${to} ${stallFilter}
      group by coalesce(s.cashier, '-') order by revenue desc
    `,
    sql<{ id: string; stall_name: string; opened_by: string | null; closed_by: string | null; opened_at: Date; closed_at: Date | null; status: string;
          opening_balance: string; cash_sales_total: string | null; expected_balance: string | null; actual_balance: string | null; difference: string | null }[]>`
      select sh.id, st.name as stall_name, sh.opened_by, sh.closed_by, sh.opened_at, sh.closed_at, sh.status,
             sh.opening_balance, sh.cash_sales_total, sh.expected_balance, sh.actual_balance, sh.difference
      from stall_shifts sh join stalls st on st.id = sh.stall_id
      where sh.opened_at >= ${wibDayStart(from).toDate()} and sh.opened_at <= ${wibDayEnd(to).toDate()} ${shiftStallFilter}
      order by sh.opened_at desc limit 200
    `,
  ]);

  // Nama lengkap akun (kasir lapak biasanya tidak punya izin 'users', jadi dibaca di server).
  const usernames = [...new Set([...cashiers.map(c => c.cashier), ...shifts.flatMap(s => [s.opened_by, s.closed_by])].filter((u): u is string => !!u && u !== '-'))];
  const profiles = usernames.length === 0 ? [] : await sql<{ username: string; full_name: string | null }[]>`select username, full_name from profiles where username in ${sql(usernames)}`;

  return Response.json({
    stalls: stalls.map(s => ({ id: s.id, name: s.name })),
    names: Object.fromEntries(profiles.filter(p => p.full_name).map(p => [p.username, p.full_name])),
    summary: { count: num(totals[0].n), revenue: num(totals[0].revenue), discount: num(totals[0].discount) },
    cashiers: cashiers.map(c => ({
      cashier: c.cashier, count: num(c.n), revenue: num(c.revenue), discount: num(c.discount),
      cash: num(c.cash), qris: num(c.qris), transfer: num(c.transfer), voids: num(c.voids), voidAmount: num(c.void_amount),
    })),
    shifts: shifts.map(s => ({
      id: s.id, stallName: s.stall_name, openedBy: s.opened_by ?? '', closedBy: s.closed_by ?? '', status: s.status,
      openedAt: toTimestamp(s.opened_at), closedAt: toTimestamp(s.closed_at), openingBalance: num(s.opening_balance),
      cashSales: s.cash_sales_total === null ? null : num(s.cash_sales_total), expected: s.expected_balance === null ? null : num(s.expected_balance),
      actual: s.actual_balance === null ? null : num(s.actual_balance), difference: s.difference === null ? null : num(s.difference),
    })),
  });
}
