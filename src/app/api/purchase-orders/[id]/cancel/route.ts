import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPo, type PoRow } from '@/lib/purchase-orders-pg';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan PO. Ditolak kalau sudah ada GR yang approved (batalkan GR-nya dulu — itu yang
// mengembalikan stok & pengeluaran). GR draft yang masih menggantung ikut dibatalkan.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const { note } = await req.json().catch(() => ({})) as { note?: string };
  const sql = getSql();
  let before: ReturnType<typeof rowToPo>;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${id} for update`;
      if (!row) throw new Error('PO tidak ditemukan.');
      if (row.status === 'batal') throw new Error('PO ini sudah dibatalkan sebelumnya.');
      const [{ exists }] = await pgTx<{ exists: boolean }[]>`select exists(select 1 from goods_receipts where po_id = ${id} and status = 'approved') as exists`;
      if (exists) throw new Error('PO ini sudah punya GR yang di-approve. Batalkan GR-nya dulu.');
      await pgTx`
        update goods_receipts set status = 'dibatalkan', cancelled_at = now(), cancel_note = 'PO dibatalkan', updated_at = now()
        where po_id = ${id} and status = 'draft'
      `;
      await pgTx`update purchase_orders set status = 'batal', cancel_note = ${note?.trim() ?? ''}, updated_at = now() where id = ${id}`;
      return rowToPo(row);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membatalkan PO.' }, { status: 400 });
  }
  try {
    await logHistory(getDb(), {
      entity: 'purchase-orders', entityId: id, entityLabel: `${before.poNumber} - ${before.supplierName}`,
      action: 'update', actor: guard, before, after: { ...before, status: 'batal', cancelNote: note?.trim() ?? '' },
    });
  } catch (err) {
    console.error('Failed to write history for PO cancel', err);
  }
  return Response.json({ ok: true });
}
