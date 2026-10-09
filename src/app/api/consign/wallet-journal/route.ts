import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { seq } from '@/lib/db-seq';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { toTimestamp } from '@/lib/orders-pg';
import { DATE_RE } from '@/lib/consign-settlement';

interface Row {
  id: string; stall_id: string; stall_name: string; kind: string; amount: string; ref_id: string | null; note: string; category: string;
  created_by: string | null; created_at: Date; balance_after: string;
}

// Jurnal kas dompet lapak: entri pada periode dengan SALDO BERJALAN per lapak, plus saldo awal periode,
// total masuk/keluar, dan saldo akhir. Tanpa stallId = semua lapak (saldo berjalan tetap per lapak).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? ''; const to = sp.get('to') ?? ''; const stallId = sp.get('stallId') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return Response.json({ error: 'Periode tidak valid.' }, { status: 400 });
  const start = wibDayStart(from).toDate(); const end = wibDayEnd(to).toDate();

  const sql = getSql();
  const stallFilter = stallId ? sql`where e.stall_id = ${stallId}` : sql``;
  const [rows, before, totals] = await seq([
    // Saldo berjalan dihitung dari SELURUH riwayat per lapak, lalu dipotong ke periode.
    sql<Row[]>`
      select * from (
        select e.id, e.stall_id, s.name as stall_name, e.kind, e.amount, e.ref_id, e.note, e.category, e.created_by, e.created_at,
               sum(e.amount) over (partition by e.stall_id order by e.created_at, e.id) as balance_after
        from stall_wallet_entries e join stalls s on s.id = e.stall_id ${stallFilter}
      ) t where t.created_at >= ${start} and t.created_at <= ${end} order by t.created_at desc, t.id desc limit 1000
    `,
    sql<{ b: string | null }[]>`select sum(amount) as b from stall_wallet_entries e where e.created_at < ${start} ${stallId ? sql`and e.stall_id = ${stallId}` : sql``}`,
    sql<{ inflow: string | null; outflow: string | null; balance: string | null }[]>`
      select sum(amount) filter (where amount > 0 and created_at >= ${start} and created_at <= ${end}) as inflow,
             sum(amount) filter (where amount < 0 and created_at >= ${start} and created_at <= ${end}) as outflow,
             sum(amount) as balance
      from stall_wallet_entries e ${stallFilter}
    `,
  ]);
  const num = (v: string | null | undefined) => Number(v ?? 0);
  return Response.json({
    entries: rows.map(r => ({
      id: r.id, stallId: r.stall_id, stallName: r.stall_name, kind: r.kind, amount: num(r.amount), refId: r.ref_id, note: r.note,
      category: r.category, createdBy: r.created_by ?? '', createdAt: toTimestamp(r.created_at), balanceAfter: num(r.balance_after),
    })),
    summary: { openingBalance: num(before[0].b), inflow: num(totals[0].inflow), outflow: -num(totals[0].outflow), currentBalance: num(totals[0].balance) },
  });
}
