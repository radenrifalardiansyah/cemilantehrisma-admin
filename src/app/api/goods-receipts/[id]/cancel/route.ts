import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission, hasPermission, forbidden } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { voidPurchaseTx, type VoidPurchaseResult } from '@/lib/material-purchase-core';
import { rowToGr, recalcPoStatus, type GrRow } from '@/lib/purchase-orders-pg';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan GR. Draft: cukup hak `edit`, tidak berdampak ke stok/keuangan. Sudah approved: butuh hak
// `approve` + alasan wajib; pembelian hasil GR di-void (stok & pengeluaran dikembalikan lewat
// voidPurchaseTx yang sama dengan void Pembelian manual — bahan yang sudah dipakai/dibeli lagi
// dilewati dan dilaporkan), lalu status PO dihitung ulang sehingga PO bisa dibuatkan GR lagi.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const { note } = await req.json().catch(() => ({})) as { note?: string };
  const reason = note?.trim() ?? '';
  const sql = getSql();

  let before: ReturnType<typeof rowToGr>;
  let voidResult = null as VoidPurchaseResult | null;
  let wasApproved = false as boolean;
  try {
    before = await sql.begin(async pgTx => {
      const [probe] = await pgTx<{ po_id: string }[]>`select po_id from goods_receipts where id = ${id}`;
      if (!probe) throw new Error('GR tidak ditemukan.');
      await pgTx`select id from purchase_orders where id = ${probe.po_id} for update`;
      const [gr] = await pgTx<GrRow[]>`select * from goods_receipts where id = ${id} for update`;
      if (gr.status === 'dibatalkan') throw new Error('GR ini sudah dibatalkan sebelumnya.');

      if (gr.status === 'approved') {
        wasApproved = true;
        if (!(await hasPermission(guard, 'materials', 'approve'))) throw new ForbiddenError();
        if (!reason) throw new Error('Alasan pembatalan wajib diisi.');
        if (gr.purchase_id) {
          const [p] = await pgTx<{ voided: boolean }[]>`select voided from material_purchases where id = ${gr.purchase_id}`;
          // Pembelian bisa saja sudah di-void lewat jalur lain — jangan gagal, cukup sinkronkan GR.
          if (p && !p.voided) voidResult = await voidPurchaseTx(pgTx, gr.purchase_id, `Pembatalan ${gr.gr_number}: ${reason}`);
        }
      }
      await pgTx`
        update goods_receipts set status = 'dibatalkan', cancelled_at = now(), cancel_note = ${reason}, updated_at = now()
        where id = ${id}
      `;
      await recalcPoStatus(pgTx, gr.po_id);
      return rowToGr(gr);
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return forbidden();
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membatalkan GR.' }, { status: 400 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'goods-receipts', entityId: id, entityLabel: before.grNumber,
      action: 'update', actor: guard, before, after: { ...before, status: 'dibatalkan', cancelNote: reason },
      meta: voidResult ? { stockReversed: voidResult.reversed, skippedMaterials: voidResult.skippedMaterials } : undefined,
    });
    if (voidResult && before.purchaseId) {
      await logHistory(getDb(), {
        entity: 'material-purchases', entityId: before.purchaseId,
        entityLabel: `${voidResult.before.supplierName?.trim() || 'Tanpa nama'} - Rp${voidResult.before.total}`,
        action: 'update', actor: guard, before: voidResult.before, after: { ...voidResult.before, ...voidResult.purchaseUpdate },
        meta: { stockReversed: voidResult.reversed, skippedMaterials: voidResult.skippedMaterials, grId: id },
      });
    }
  } catch (err) {
    console.error('Failed to write history for GR cancel', err);
  }
  if (wasApproved) {
    if (voidResult?.reversed) revalidateTag('admin-materials', { expire: 0 });
    if (voidResult?.expenseDeleted) revalidateTag('admin-expenses', { expire: 0 });
    revalidateTag('admin-analytics', { expire: 0 });
  }
  return Response.json({
    ok: true,
    reversed: voidResult ? voidResult.reversed : null,
    skippedMaterials: voidResult ? voidResult.skippedMaterials : [],
  });
}

class ForbiddenError extends Error {}
