import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission, hasPermission, forbidden } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPo, type PoRow } from '@/lib/purchase-orders-pg';

type Ctx = { params: Promise<{ id: string }> };

// Rollback PO terkirim → draft supaya isinya bisa diedit lagi. Butuh hak `approve`; alasan wajib.
// Ditolak kalau PO sudah punya GR (rollback/hapus GR-nya dulu) atau sudah dibatalkan (final).
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'purchasing', 'edit');
  if (guard instanceof Response) return guard;
  if (!(await hasPermission(guard, 'purchasing', 'approve'))) return forbidden();
  const { id } = await ctx.params;
  const { note } = await req.json().catch(() => ({})) as { note?: string };
  const reason = note?.trim() ?? '';
  if (!reason) return Response.json({ error: 'Alasan rollback wajib diisi.' }, { status: 400 });
  const sql = getSql();
  let before: ReturnType<typeof rowToPo>;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${id} for update`;
      if (!row) throw new Error('PO tidak ditemukan.');
      if (row.status === 'batal') throw new Error('PO yang dibatalkan bersifat final dan tidak bisa di-rollback.');
      if (row.status === 'draft') throw new Error('PO ini masih draft.');
      const [{ approved, draft }] = await pgTx<{ approved: number; draft: number }[]>`
        select count(*) filter (where status = 'approved')::int as approved, count(*) filter (where status = 'draft')::int as draft
        from goods_receipts where po_id = ${id}
      `;
      if (approved > 0) throw new Error('PO ini sudah punya GR yang di-approve. Rollback GR-nya dulu.');
      if (draft > 0) throw new Error('PO ini masih punya GR draft. Hapus atau batalkan GR draft-nya dulu.');
      await pgTx`update purchase_orders set status = 'draft', sent_at = null, updated_at = now() where id = ${id}`;
      return rowToPo(row);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal rollback PO.' }, { status: 400 });
  }
  try {
    await logHistory(getDb(), {
      entity: 'purchase-orders', entityId: id, entityLabel: `${before.poNumber} - rollback ke draft`,
      action: 'update', actor: guard, before, after: { ...before, status: 'draft', sentAt: null },
      meta: { rollbackReason: reason },
    });
  } catch (err) {
    console.error('Failed to write history for PO rollback', err);
  }
  return Response.json({ ok: true });
}
