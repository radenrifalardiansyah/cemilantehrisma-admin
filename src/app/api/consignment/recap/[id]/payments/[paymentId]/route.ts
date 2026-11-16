import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { WalletBalanceError } from '@/lib/wallet-balance';
import { PaymentError, remainingOf } from '@/lib/recap-payments-core';
import { cancelRecapPaymentTx } from '@/lib/recap-payments';

type Ctx = { params: Promise<{ id: string; paymentId: string }> };

// Batalkan satu pembayaran rekap (salah input): uang keluar lagi dari dompet (ditolak bila saldo jadi minus), rekap yang
// tadinya lunas kembali belum lunas. Baris pembayaran tetap ada (voided) sebagai jejak. Pembayaran yang sudah masuk
// Closing tidak bisa dibatalkan. Izin sama dengan PATCH rekap (consignment edit).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id, paymentId } = await ctx.params;
  const sql = getSql();
  let result: Awaited<ReturnType<typeof cancelRecapPaymentTx>>;
  try {
    result = await sql.begin(pgTx => cancelRecapPaymentTx(pgTx, id, paymentId));
  } catch (err) {
    if (err instanceof PaymentError || err instanceof WalletBalanceError) return Response.json({ error: err.message }, { status: 400 });
    console.error('Failed to cancel consignment recap payment', err);
    return Response.json({ error: 'Gagal membatalkan pembayaran.' }, { status: 500 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'consignment', entityCollection: 'consignmentRecaps', entityId: id,
      entityLabel: result.before.locationName || id,
      action: 'update', actor: guard, before: result.before,
      after: { ...result.before, paymentStatus: result.reopened ? 'belum_lunas' : result.before.paymentStatus, paidAmount: result.paidAfter, remaining: remainingOf(result.before.totalRevenue, result.paidAfter) },
      meta: { cancelledPayment: { id: paymentId, amount: result.payment.amount, date: result.payment.date }, reopened: result.reopened },
    });
  } catch (err) {
    console.error('Failed to write history for consignment recap payment cancel', err);
  }
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, reopened: result.reopened });
}
