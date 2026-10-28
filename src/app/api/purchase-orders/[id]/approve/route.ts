import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPo, type PoRow } from '@/lib/purchase-orders-pg';

type Ctx = { params: Promise<{ id: string }> };

// Approve PO: draft → disetujui. Setelah ini PO terkunci dari edit, bisa dikirim ke supplier, dan
// baru boleh dibuatkan GR. Nama + waktu approver tercetak sebagai tanda tangan di PDF.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'purchase-orders', 'approve');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  let before: ReturnType<typeof rowToPo>;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${id} for update`;
      if (!row) throw new Error('PO tidak ditemukan.');
      if (row.status === 'batal') throw new Error('PO ini sudah dibatalkan.');
      if (row.status !== 'draft') throw new Error('PO ini sudah di-approve.');
      await pgTx`
        update purchase_orders set status = 'disetujui', approved_by = ${guard.username}, approved_at = now(), updated_at = now()
        where id = ${id}
      `;
      return rowToPo(row);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal meng-approve PO.' }, { status: 400 });
  }
  try {
    await logHistory(getDb(), {
      entity: 'purchase-orders', entityId: id, entityLabel: `${before.poNumber} - ${before.supplierName} - approved`,
      action: 'update', actor: guard, before, after: { ...before, status: 'disetujui', approvedBy: guard.username },
    });
  } catch (err) {
    console.error('Failed to write history for PO approve', err);
  }
  return Response.json({ ok: true });
}
