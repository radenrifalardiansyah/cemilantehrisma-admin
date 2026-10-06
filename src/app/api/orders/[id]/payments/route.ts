import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToOrder, syncInvoicePaymentStatus, OrderRow } from '@/lib/orders-pg';
import { paidAmountOf, rowToPayment, type OrderPaymentRow } from '@/lib/order-payments-pg';
import { installmentState, paymentProblem } from '@/lib/installment';

type Ctx = { params: Promise<{ id: string }> };
class PaymentError extends Error {}

// Riwayat pembayaran bertahap (cicilan) sebuah pesanan kredit.
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'orders', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const rows = await sql<OrderPaymentRow[]>`select * from order_payments where order_id = ${id} order by paid_at asc, created_at asc`;
  return Response.json({ payments: rows.map(rowToPayment) });
}

// Catat satu penerimaan uang. Uang langsung masuk saldo dompet yang dipilih; saat total cicilan
// menyamai total pesanan, status otomatis jadi Lunas. Tidak boleh melebihi sisa tagihan.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'orders', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json() as { amount?: number; walletId?: string; paidAt?: string; note?: string };
  const sql = getSql();

  let result: { before: ReturnType<typeof rowToOrder>; state: ReturnType<typeof installmentState>; invoiceNo?: string };
  try {
    result = await sql.begin(async tx => {
      const [row] = await tx<OrderRow[]>`select * from orders where id = ${id} for update`;
      if (!row) throw new PaymentError('Pesanan tidak ditemukan.');
      const order = rowToOrder(row);
      if (order.status === 'dibatalkan') throw new PaymentError('Pesanan yang sudah dibatalkan tidak bisa menerima pembayaran.');
      if (order.paymentStatus !== 'belum_lunas') throw new PaymentError('Pesanan ini sudah lunas.');
      if (!body.walletId) throw new PaymentError('Pilih dompet tujuan pembayaran.');
      const [wallet] = await tx<{ id: string; is_active: boolean | null }[]>`select id, is_active from wallets where id = ${body.walletId}`;
      if (!wallet) throw new PaymentError('Dompet tidak ditemukan.');
      if (wallet.is_active === false) throw new PaymentError('Dompet tidak aktif.');

      const paid = await paidAmountOf(tx, id);
      const problem = paymentProblem(order.total, paid, body.amount);
      if (problem) throw new PaymentError(problem);

      const paidAt = body.paidAt && !Number.isNaN(Date.parse(body.paidAt)) ? new Date(body.paidAt) : new Date();
      await tx`
        insert into order_payments (id, order_id, wallet_id, amount, paid_at, note, created_by)
        values (${randomUUID()}, ${id}, ${body.walletId}, ${Number(body.amount)}, ${paidAt}, ${(body.note ?? '').trim().slice(0, 200) || null}, ${guard.username})
      `;
      const state = installmentState(order.total, paid + Number(body.amount));
      if (state.isPaidOff) {
        await tx`update orders set payment_status = 'lunas', updated_at = now() where id = ${id}`;
      } else {
        await tx`update orders set updated_at = now() where id = ${id}`;
      }
      return { before: order, state, invoiceNo: order.invoiceNo };
    });
  } catch (err) {
    if (err instanceof PaymentError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mencatat pembayaran.' }, { status: 400 });
  }

  if (result.state.isPaidOff) await syncInvoicePaymentStatus(sql, result.invoiceNo, 'lunas');
  try {
    await logHistory(getDb(), {
      entity: 'orders', entityId: id, entityLabel: `Pesanan ${result.before.invoiceNo ?? id}`,
      action: 'update', actor: guard,
      before: { paid: result.state.paid - Number(body.amount) },
      after: { paid: result.state.paid, remaining: result.state.remaining, payment: { amount: Number(body.amount), walletId: body.walletId, note: body.note } },
    });
  } catch (err) {
    console.error('Failed to write history for order payment', err);
  }
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, paid: result.state.paid, remaining: result.state.remaining, paidOff: result.state.isPaidOff });
}
