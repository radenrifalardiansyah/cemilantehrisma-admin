import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { parseDateKey } from '@/lib/validate-input';
import { WalletBalanceError } from '@/lib/wallet-balance';
import { PaymentError, paidAtFromDate, recapRemaining } from '@/lib/recap-payments-core';
import { addRecapPaymentTx, rowToRecapPayment, type RecapPaymentRow } from '@/lib/recap-payments';

type Ctx = { params: Promise<{ id: string }> };

// Riwayat pembayaran/cicilan sebuah rekap (termasuk yang dibatalkan, ditandai `voided`).
// Rekap lunas lama yang tak punya baris pembayaran: payments kosong, sisa 0.
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [r] = await sql<{ total_revenue: string; payment_status: string }[]>`select total_revenue, payment_status from consignment_recaps where id = ${id}`;
  if (!r) return Response.json({ error: 'Rekap tidak ditemukan.' }, { status: 404 });
  const rows = await sql<RecapPaymentRow[]>`select * from consignment_recap_payments where recap_id = ${id} order by paid_at, created_at`;
  const payments = rows.map(rowToRecapPayment);
  const paid = payments.filter(x => !x.voided).reduce((s, x) => s + x.amount, 0);
  const total = Number(r.total_revenue);
  return Response.json({ payments, total, paid, remaining: recapRemaining({ paymentStatus: r.payment_status, total, paid }), paymentStatus: r.payment_status });
}

// Bayar sebagian/seluruh sisa piutang rekap. Body: { amount, date?, walletId, note? }.
// Izin sama dengan PATCH rekap (consignment edit).
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { amount?: unknown; date?: unknown; walletId?: string | null; note?: unknown };
  const date = parseDateKey(body.date);
  if (!date) return Response.json({ error: 'Tanggal bayar tidak valid (format YYYY-MM-DD).' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const sql = getSql();
  let result: Awaited<ReturnType<typeof addRecapPaymentTx>>;
  try {
    result = await sql.begin(pgTx => addRecapPaymentTx(pgTx, {
      recapId: id, amount: body.amount ?? 0, paidAt: paidAtFromDate(date, new Date()), walletId: body.walletId || null, requireWallet: true, note, actor: guard.username,
    }));
  } catch (err) {
    if (err instanceof PaymentError || err instanceof WalletBalanceError) return Response.json({ error: err.message }, { status: 400 });
    console.error('Failed to add consignment recap payment', err);
    return Response.json({ error: 'Gagal mencatat pembayaran.' }, { status: 500 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'consignment', entityCollection: 'consignmentRecaps', entityId: id,
      entityLabel: result.before.locationName || id,
      action: 'update', actor: guard, before: result.before,
      after: { ...result.before, paymentStatus: result.settled ? 'lunas' : result.before.paymentStatus, paidAmount: result.paidAfter, remaining: result.remainingAfter },
      meta: { payment: { id: result.paymentId, amount: result.amount, date, walletId: body.walletId ?? null, note }, settled: result.settled },
    });
  } catch (err) {
    console.error('Failed to write history for consignment recap payment', err);
  }
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, paymentId: result.paymentId, amount: result.amount, remaining: result.remainingAfter, settled: result.settled });
}
