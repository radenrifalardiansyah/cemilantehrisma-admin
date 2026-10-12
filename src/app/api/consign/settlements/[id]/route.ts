import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { auditConsign } from '@/lib/consign-audit';
import { DATE_RE, loadUnsettledLines, rowToSettlement, type SettlementRow } from '@/lib/consign-settlement';

type Ctx = { params: Promise<{ id: string }> };

class EditError extends Error {}

// Ubah rekap yang BELUM dibayar: periode dan catatan. Penjualan dilepas lalu dikunci ulang sesuai periode baru.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const sql = getSql();
  try {
    const result = await sql.begin(async tx => {
      const [st] = await tx<SettlementRow[]>`select * from consign_settlements where id = ${id} for update`;
      if (!st) throw new EditError('NOT_FOUND');
      if (st.status !== 'unpaid') throw new EditError('Rekap yang sudah dibayar tidak bisa diubah — batalkan pembayarannya dulu.');
      const from = typeof data.from === 'string' ? data.from : st.period_from;
      const to = typeof data.to === 'string' ? data.to : st.period_to;
      if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new EditError('Periode tidak valid.');
      const note = typeof data.note === 'string' ? data.note.trim().slice(0, 200) : st.note;
      await tx`update consign_sale_lines set settlement_id = null where settlement_id = ${id}`;
      const found = await loadUnsettledLines(tx, { stallId: st.stall_id, consignorId: st.consignor_id, from, to, lock: true });
      if (found.count === 0) throw new EditError('Tidak ada penjualan yang belum direkap pada periode itu.');
      await tx`update consign_sale_lines set settlement_id = ${id} where id in ${tx(found.ids)}`;
      const [row] = await tx<SettlementRow[]>`
        update consign_settlements set period_from = ${from}, period_to = ${to}, total_amount = ${found.total}, lines_count = ${found.count},
          items = ${tx.json(found.items as never)}, note = ${note} where id = ${id} returning *
      `;
      return { before: st, after: row };
    });
    await auditConsign(guard, 'update', 'settlements', id, `Ubah rekap ${result.after.doc_number}`,
      { from: result.before.period_from, to: result.before.period_to, total: Number(result.before.total_amount) },
      { from: result.after.period_from, to: result.after.period_to, total: Number(result.after.total_amount) });
    return Response.json({ settlement: rowToSettlement(result.after) });
  } catch (err) {
    if (err instanceof EditError) {
      return err.message === 'NOT_FOUND' ? Response.json({ error: 'Rekap tidak ditemukan.' }, { status: 404 }) : Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

// Hapus rekap yang BELUM dibayar: baris penjualannya dilepas lagi (bisa direkap ulang).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const outcome = await sql.begin(async tx => {
    const [st] = await tx<SettlementRow[]>`select * from consign_settlements where id = ${id} for update`;
    if (!st) return 'notfound' as const;
    if (st.status !== 'unpaid') return 'paid' as const;
    await tx`update consign_sale_lines set settlement_id = null where settlement_id = ${id}`;
    await tx`delete from consign_settlements where id = ${id}`;
    return st;
  });
  if (outcome === 'notfound') return Response.json({ error: 'Rekap tidak ditemukan.' }, { status: 404 });
  if (outcome === 'paid') return Response.json({ error: 'Rekap yang sudah dibayar tidak bisa dibatalkan.' }, { status: 400 });
  await auditConsign(guard, 'delete', 'settlements', id, `Batal rekap ${outcome.doc_number}`, { total: Number(outcome.total_amount) }, null);
  return Response.json({ ok: true });
}
