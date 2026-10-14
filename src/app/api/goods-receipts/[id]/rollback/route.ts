import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission, hasPermission, forbidden } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { voidPurchaseTx, type VoidPurchaseResult } from '@/lib/material-purchase-core';
import { rowToGr, recalcPoStatus, type GrRow } from '@/lib/purchase-orders-pg';

type Ctx = { params: Promise<{ id: string }> };

// Rollback GR (dan DO-nya, yang ikut GR) dari approved → draft supaya bisa diedit lagi lalu di-approve
// ulang. Butuh hak `approve`; alasan wajib. Pembelian hasil GR di-void (stok & pengeluaran kembali).
// Beda dengan batal: kalau stok tidak bisa dikembalikan dengan aman (bahan sudah dipakai/dibeli lagi
// setelah GR ini) rollback DITOLAK seluruhnya — kalau lanjut, approve ulang akan menggandakan stok.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'goods-receipts', 'edit');
  if (guard instanceof Response) return guard;
  if (!(await hasPermission(guard, 'goods-receipts', 'approve'))) return forbidden();
  const { id } = await ctx.params;
  const { note } = await req.json().catch(() => ({})) as { note?: string };
  const reason = note?.trim() ?? '';
  if (!reason) return Response.json({ error: 'Alasan rollback wajib diisi.' }, { status: 400 });
  const sql = getSql();

  let before: ReturnType<typeof rowToGr>;
  let voidResult = null as VoidPurchaseResult | null;
  try {
    before = await sql.begin(async pgTx => {
      const [probe] = await pgTx<{ po_id: string }[]>`select po_id from goods_receipts where id = ${id}`;
      if (!probe) throw new Error('GR tidak ditemukan.');
      await pgTx`select id from purchase_orders where id = ${probe.po_id} for update`;
      const [gr] = await pgTx<GrRow[]>`select * from goods_receipts where id = ${id} for update`;
      if (gr.status !== 'approved') throw new Error('Hanya GR yang sudah di-approve yang bisa di-rollback.');
      if (gr.purchase_id) {
        const [p] = await pgTx<{ voided: boolean }[]>`select voided from material_purchases where id = ${gr.purchase_id}`;
        if (p && !p.voided) {
          voidResult = await voidPurchaseTx(pgTx, gr.purchase_id, `Rollback ${gr.gr_number}: ${reason}`);
          if (!voidResult.reversed) {
            throw new Error(`Stok ${voidResult.skippedMaterials.join(', ')} sudah dipakai/dibeli lagi setelah GR ini, jadi tidak bisa di-rollback dengan aman. Batalkan GR lalu koreksi stok di menu Stok.`);
          }
        }
      }
      await pgTx`
        update goods_receipts set status = 'draft', purchase_id = null, approved_by = null, approved_at = null, updated_at = now()
        where id = ${id}
      `;
      await recalcPoStatus(pgTx, gr.po_id);
      return rowToGr(gr);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal rollback GR.' }, { status: 400 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'goods-receipts', entityId: id, entityLabel: `${before.grNumber} - rollback ke draft`,
      action: 'update', actor: guard, before, after: { ...before, status: 'draft', purchaseId: null, approvedBy: null, approvedAt: null },
      meta: { rollbackReason: reason },
    });
    if (voidResult && before.purchaseId) {
      await logHistory(getDb(), {
        entity: 'material-purchases', entityId: before.purchaseId,
        entityLabel: `${voidResult.before.supplierName?.trim() || 'Tanpa nama'} - Rp${voidResult.before.total}`,
        action: 'update', actor: guard, before: voidResult.before, after: { ...voidResult.before, ...voidResult.purchaseUpdate },
        meta: { stockReversed: voidResult.reversed, grId: id, rollbackReason: reason },
      });
    }
  } catch (err) {
    console.error('Failed to write history for GR rollback', err);
  }
  if (voidResult) {
    revalidateTag('admin-materials', { expire: 0 });
    if (voidResult.expenseDeleted) revalidateTag('admin-expenses', { expire: 0 });
  }
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true });
}
