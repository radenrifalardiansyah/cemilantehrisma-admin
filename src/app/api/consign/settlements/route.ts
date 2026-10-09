import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDateKey } from '@/lib/date';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { auditConsign } from '@/lib/consign-audit';
import { DATE_RE, rowToSettlement, loadUnsettledLines, type SettlementRow } from '@/lib/consign-settlement';

// Daftar rekap + hutang yang belum direkap (dikelompokkan per lapak × penitip).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [rows, payables] = await Promise.all([
    sql<SettlementRow[]>`select * from consign_settlements order by created_at desc limit 500`,
    sql<{ stall_id: string; consignor_id: string; consignor_name: string; amount: string; lines: string; first_at: Date; last_at: Date }[]>`
      select l.stall_id, l.consignor_id, l.consignor_name, sum(l.consignor_amount) as amount, count(*) as lines,
             min(l.created_at) as first_at, max(l.created_at) as last_at
      from consign_sale_lines l join stall_sales s on s.id = l.sale_id
      where not l.voided and l.settlement_id is null and s.status = 'paid'
      group by l.stall_id, l.consignor_id, l.consignor_name
    `,
  ]);
  return Response.json({
    settlements: rows.map(rowToSettlement),
    payables: payables.map(p => ({
      stallId: p.stall_id, consignorId: p.consignor_id, consignorName: p.consignor_name,
      amount: Number(p.amount), lines: Number(p.lines), firstDate: wibDateKey(p.first_at), lastDate: wibDateKey(p.last_at),
    })),
  });
}

// Buat rekap: semua baris bagi hasil yang belum direkap untuk lapak × penitip dalam periode
// dikunci ke dokumen ini (tidak bisa masuk rekap lain, dan penjualannya tidak bisa dibatalkan lagi).
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const stallId = typeof data.stallId === 'string' ? data.stallId : '';
  const consignorId = typeof data.consignorId === 'string' ? data.consignorId : '';
  const from = typeof data.from === 'string' ? data.from : '';
  const to = typeof data.to === 'string' ? data.to : '';
  if (!stallId || !consignorId) return Response.json({ error: 'Lapak dan penitip wajib dipilih.' }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return Response.json({ error: 'Periode tidak valid.' }, { status: 400 });

  const sql = getSql();
  const [stall] = await sql<{ id: string; name: string }[]>`select id, name from stalls where id = ${stallId}`;
  const [consignor] = await sql<{ id: string; name: string }[]>`select id, name from consignors where id = ${consignorId}`;
  if (!stall || !consignor) return Response.json({ error: 'Lapak atau penitip tidak ditemukan.' }, { status: 400 });

  const result = await sql.begin(async tx => {
    const found = await loadUnsettledLines(tx, { stallId, consignorId, from, to, lock: true });
    if (found.count === 0) return null;
    const id = randomUUID();
    const docNumber = await nextDocNumber(tx, 'TJB', periodOf(wibDateKey(new Date())));
    await tx`
      insert into consign_settlements (id, doc_number, stall_id, stall_name, consignor_id, consignor_name, period_from, period_to,
        total_amount, lines_count, items, status, note, created_by, created_at)
      values (${id}, ${docNumber}, ${stall.id}, ${stall.name}, ${consignor.id}, ${consignor.name}, ${from}, ${to},
        ${found.total}, ${found.count}, ${tx.json(found.items as never)}, 'unpaid', ${typeof data.note === 'string' ? data.note.trim().slice(0, 200) : ''}, ${guard.username}, now())
    `;
    await tx`update consign_sale_lines set settlement_id = ${id} where id in ${tx(found.ids)}`;
    return { id, docNumber, total: found.total };
  });
  if (!result) return Response.json({ error: 'Tidak ada penjualan yang belum direkap pada periode ini.' }, { status: 400 });
  await auditConsign(guard, 'create', 'settlements', result.id, `Rekap ${result.docNumber}`, null, { stall: stall.name, consignor: consignor.name, from, to, total: result.total });
  return Response.json(result);
}
