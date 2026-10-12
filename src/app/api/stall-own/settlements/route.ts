import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { seq } from '@/lib/db-seq';
import { withDeadlockRetry } from '@/lib/db-retry';
import { requirePermission } from '@/lib/rbac';
import { wibDateKey } from '@/lib/date';
import { auditConsign } from '@/lib/consign-audit';
import { DATE_RE, createOwnSettlementDoc, rowToOwnSettlement, type OwnSettlementRow } from '@/lib/stall-own';

// Daftar setoran + tagihan yang belum direkap (per lapak).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-own', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [rows, payables] = await seq([
    sql<OwnSettlementRow[]>`select * from stall_own_settlements order by created_at desc limit 500`,
    sql<{ stall_id: string; amount: string; lines: string; first_at: Date; last_at: Date }[]>`
      select l.stall_id, sum(l.amount) as amount, count(*) as lines, min(l.created_at) as first_at, max(l.created_at) as last_at
      from stall_own_lines l join stall_sales s on s.id = l.sale_id
      where not l.voided and l.settlement_id is null and s.status = 'paid'
      group by l.stall_id
    `,
  ]);
  return Response.json({
    settlements: rows.map(rowToOwnSettlement),
    payables: payables.map(p => ({ stallId: p.stall_id, amount: Number(p.amount), lines: Number(p.lines), firstDate: wibDateKey(p.first_at), lastDate: wibDateKey(p.last_at) })),
  });
}

// Buat rekap setoran: semua penjualan produk toko yang belum direkap di lapak itu pada periode dikunci ke dokumen.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-own', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const stallId = typeof data.stallId === 'string' ? data.stallId : '';
  const from = typeof data.from === 'string' ? data.from : '';
  const to = typeof data.to === 'string' ? data.to : '';
  if (!stallId) return Response.json({ error: 'Lapak wajib dipilih.' }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return Response.json({ error: 'Periode tidak valid.' }, { status: 400 });
  const sql = getSql();
  const [stall] = await sql<{ id: string; name: string }[]>`select id, name from stalls where id = ${stallId}`;
  if (!stall) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 400 });
  const result = await withDeadlockRetry(() => sql.begin(tx => createOwnSettlementDoc(tx, { stall, from, to, note: typeof data.note === 'string' ? data.note : '', createdBy: guard.username })));
  if (!result) return Response.json({ error: 'Tidak ada penjualan produk toko yang belum direkap pada periode ini.' }, { status: 400 });
  await auditConsign(guard, 'create', 'stall-settlements', result.id, `Setoran ${result.docNumber}`, null, { stall: stall.name, from, to, total: result.total });
  return Response.json(result);
}
