import type postgres from 'postgres';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgTx = postgres.ISql<{}>;

export interface OrderPaymentRow {
  id: string; order_id: string; wallet_id: string | null; amount: string; paid_at: Date;
  note: string | null; created_by: string | null; created_at: Date;
}

export function rowToPayment(r: OrderPaymentRow) {
  return {
    id: r.id, orderId: r.order_id, walletId: r.wallet_id,
    amount: Number(r.amount), paidAt: r.paid_at.toISOString(),
    note: r.note ?? '', createdBy: r.created_by ?? '',
  };
}

// Total yang sudah diterima untuk satu pesanan lewat cicilan (0 kalau tidak ada baris).
export async function paidAmountOf(tx: PgTx, orderId: string): Promise<number> {
  const [row] = await tx<{ total: string }[]>`select coalesce(sum(amount), 0) as total from order_payments where order_id = ${orderId}`;
  return Number(row.total) || 0;
}

export async function hasPayments(tx: PgTx, orderId: string): Promise<boolean> {
  const [row] = await tx<{ n: string }[]>`select count(*) as n from order_payments where order_id = ${orderId}`;
  return Number(row.n) > 0;
}
