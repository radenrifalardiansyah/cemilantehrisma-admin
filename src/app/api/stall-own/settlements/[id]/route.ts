import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { auditConsign } from '@/lib/consign-audit';
import { rowToOwnSettlement, type OwnSettlementRow } from '@/lib/stall-own';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan setoran yang belum dibayar: baris penjualannya dilepas lagi supaya bisa direkap ulang.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'stall-own', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const result = await sql.begin(async tx => {
    const [st] = await tx<OwnSettlementRow[]>`select * from stall_own_settlements where id = ${id} for update`;
    if (!st) return { error: 'Setoran tidak ditemukan.', status: 404 };
    if (st.status !== 'unpaid') return { error: 'Setoran yang sudah dibayar tidak bisa dibatalkan.', status: 400 };
    await tx`update stall_own_lines set settlement_id = null where settlement_id = ${id}`;
    await tx`delete from stall_own_settlements where id = ${id}`;
    return { st };
  });
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status });
  await auditConsign(guard, 'delete', 'stall-settlements', id, `Setoran ${result.st.doc_number}`, { status: 'unpaid', total: Number(result.st.total_amount) }, null);
  return Response.json({ settlement: rowToOwnSettlement(result.st) });
}
