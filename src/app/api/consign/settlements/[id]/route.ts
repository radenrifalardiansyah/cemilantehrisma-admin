import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { auditConsign } from '@/lib/consign-audit';
import type { SettlementRow } from '@/lib/consign-settlement';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan rekap yang BELUM dibayar: baris penjualannya dilepas lagi (bisa direkap ulang).
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
