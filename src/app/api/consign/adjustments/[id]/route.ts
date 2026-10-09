import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { ConsignStockError } from '@/lib/consign-receipts';
import { voidAdjustment, rowToAdjustment, type AdjustmentRow } from '@/lib/consign-adjustments';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan penyesuaian stok: stok kembali seperti sebelumnya, kompensasi (bila ada) dihapus.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  try {
    const done = await sql.begin(async tx => {
      const [row] = await tx<AdjustmentRow[]>`select * from consign_adjustments where id = ${id} for update`;
      if (!row) return null;
      const a = rowToAdjustment(row);
      await voidAdjustment(tx, a);
      return a;
    });
    if (!done) return Response.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404 });
    await auditConsign(guard, 'delete', 'adjustments', id, `Batal ${done.docNumber}`, { docNumber: done.docNumber, totalCompensation: done.totalCompensation }, null);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
