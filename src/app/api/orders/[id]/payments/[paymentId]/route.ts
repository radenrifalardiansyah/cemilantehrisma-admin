import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { guardWalletBalances, WalletBalanceError } from '@/lib/wallet-balance';
import { rowToOrder, syncInvoicePaymentStatus, OrderRow } from '@/lib/orders-pg';
import { paidAmountOf, type OrderPaymentRow } from '@/lib/order-payments-pg';

type Ctx = { params: Promise<{ id: string; paymentId: string }> };
class PaymentError extends Error {}

// Batalkan satu catatan pembayaran (salah input). Uangnya keluar lagi dari dompet — ditolak kalau
// itu membuat saldo dompet minus. Pesanan yang sudah Lunas kembali jadi Belum Lunas.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'orders', 'delete');
  if (guard instanceof Response) return guard;
  const { id, paymentId } = await ctx.params;
  const sql = getSql();

  let info: { invoiceNo?: string; reopened: boolean; amount: number };
  try {
    info = await sql.begin(async tx => {
      const [row] = await tx<OrderRow[]>`select * from orders where id = ${id} for update`;
      if (!row) throw new PaymentError('Pesanan tidak ditemukan.');
      const order = rowToOrder(row);
      const [payment] = await tx<OrderPaymentRow[]>`select * from order_payments where id = ${paymentId} and order_id = ${id}`;
      if (!payment) throw new PaymentError('Catatan pembayaran tidak ditemukan.');

      await guardWalletBalances(tx, [payment.wallet_id], async () => {
        await tx`delete from order_payments where id = ${paymentId}`;
      });
      const paid = await paidAmountOf(tx, id);
      const reopened = order.paymentStatus === 'lunas' && paid < order.total;
      if (reopened) await tx`update orders set payment_status = 'belum_lunas', updated_at = now() where id = ${id}`;
      else await tx`update orders set updated_at = now() where id = ${id}`;
      return { invoiceNo: order.invoiceNo, reopened, amount: Number(payment.amount) };
    });
  } catch (err) {
    if (err instanceof PaymentError || err instanceof WalletBalanceError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membatalkan pembayaran.' }, { status: 400 });
  }

  if (info.reopened) await syncInvoicePaymentStatus(sql, info.invoiceNo, 'belum_lunas');
  try {
    await logHistory(getDb(), {
      entity: 'orders', entityId: id, entityLabel: `Pesanan ${info.invoiceNo ?? id}`,
      action: 'delete', actor: guard, before: { payment: { id: paymentId, amount: info.amount } },
    });
  } catch (err) {
    console.error('Failed to write history for order payment delete', err);
  }
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true });
}
