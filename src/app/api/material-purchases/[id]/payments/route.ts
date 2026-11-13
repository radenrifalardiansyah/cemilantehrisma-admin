import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { parseDateKey } from '@/lib/validate-input';
import { WalletBalanceError } from '@/lib/wallet-balance';
import { PaymentError, remainingOf } from '@/lib/payables-core';
import { addPurchasePaymentTx, rowToPayment, type PaymentRow } from '@/lib/purchase-payments';

type Ctx = { params: Promise<{ id: string }> };

// Riwayat pembayaran/cicilan sebuah pembelian (termasuk yang dibatalkan, ditandai `voided`).
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [p] = await sql<{ total: string; payment_status: string }[]>`select total, payment_status from material_purchases where id = ${id}`;
  if (!p) return Response.json({ error: 'Pembelian tidak ditemukan.' }, { status: 404 });
  const rows = await sql<PaymentRow[]>`select * from material_purchase_payments where purchase_id = ${id} order by date, created_at`;
  const payments = rows.map(rowToPayment);
  const paid = payments.filter(x => !x.voided).reduce((s, x) => s + x.amount, 0);
  const total = Number(p.total);
  return Response.json({ payments, total, paid, remaining: p.payment_status === 'lunas' ? 0 : remainingOf(total, paid) });
}

// Bayar sebagian/seluruh sisa hutang pembelian. Body: { amount, date?, walletId, note? }.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { amount?: unknown; date?: unknown; walletId?: string | null; note?: unknown };
  const date = parseDateKey(body.date);
  if (!date) return Response.json({ error: 'Tanggal bayar tidak valid (format YYYY-MM-DD).' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const sql = getSql();
  let result: Awaited<ReturnType<typeof addPurchasePaymentTx>>;
  try {
    result = await sql.begin(pgTx => addPurchasePaymentTx(pgTx, {
      purchaseId: id, amount: body.amount ?? 0, date, walletId: body.walletId || null, note, actor: guard.username,
    }));
  } catch (err) {
    if (err instanceof PaymentError || err instanceof WalletBalanceError) return Response.json({ error: err.message }, { status: 400 });
    console.error('Failed to add material purchase payment', err);
    return Response.json({ error: 'Gagal mencatat pembayaran.' }, { status: 500 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'material-purchases', entityId: id,
      entityLabel: `${result.before.supplierName?.trim() || 'Tanpa nama'} - Rp${result.before.total}`,
      action: 'update', actor: guard, before: result.before,
      after: { ...result.before, paymentStatus: result.settled ? 'lunas' : result.before.paymentStatus, paidAmount: result.paidAfter, remaining: result.remainingAfter },
      meta: { payment: { id: result.paymentId, amount: result.amount, date, walletId: body.walletId ?? null, note }, settled: result.settled },
    });
  } catch (err) {
    console.error('Failed to write history for material purchase payment', err);
  }
  revalidateTag('admin-expenses', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, paymentId: result.paymentId, amount: result.amount, remaining: result.remainingAfter, settled: result.settled });
}
