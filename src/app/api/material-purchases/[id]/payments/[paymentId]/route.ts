import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { PaymentError, remainingOf } from '@/lib/payables-core';
import { cancelPurchasePaymentTx } from '@/lib/purchase-payments';

type Ctx = { params: Promise<{ id: string; paymentId: string }> };

// Batalkan satu cicilan: pengeluaran pasangannya dihapus (saldo dompet kembali), pembelian yang tadinya lunas
// kembali belum lunas. Baris pembayaran tetap ada (voided) sebagai jejak.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id, paymentId } = await ctx.params;
  const sql = getSql();
  let result: Awaited<ReturnType<typeof cancelPurchasePaymentTx>>;
  try {
    result = await sql.begin(pgTx => cancelPurchasePaymentTx(pgTx, id, paymentId));
  } catch (err) {
    if (err instanceof PaymentError) return Response.json({ error: err.message }, { status: 400 });
    console.error('Failed to cancel material purchase payment', err);
    return Response.json({ error: 'Gagal membatalkan pembayaran.' }, { status: 500 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'material-purchases', entityId: id,
      entityLabel: `${result.before.supplierName?.trim() || 'Tanpa nama'} - Rp${result.before.total}`,
      action: 'update', actor: guard, before: result.before,
      after: { ...result.before, paymentStatus: result.reopened ? 'belum_lunas' : result.before.paymentStatus, paidAmount: result.paidAfter, remaining: remainingOf(result.before.total, result.paidAfter) },
      meta: { cancelledPayment: { id: paymentId, amount: result.payment.amount, date: result.payment.date }, reopened: result.reopened },
    });
  } catch (err) {
    console.error('Failed to write history for material purchase payment cancel', err);
  }
  revalidateTag('admin-expenses', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, reopened: result.reopened });
}
