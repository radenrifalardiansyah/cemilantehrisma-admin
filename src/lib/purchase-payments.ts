import { randomUUID } from 'crypto';
import type { PgTx } from '@/lib/doc-number';
import { guardWalletBalances } from '@/lib/wallet-balance';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';
import { PAY_TOLERANCE, PaymentError, remainingOf, settlesPurchase, validatePaymentAmount } from '@/lib/payables-core';

// Akses DB untuk pembayaran/cicilan pembelian bahan baku (hutang supplier). Semua fungsi jalan di dalam
// transaksi `pgTx` milik pemanggil. Bagian murni (status, toleransi, validasi) ada di payables-core.ts.
//
// Urutan kunci: baris material_purchases (for update) -> (saat batal) baris pembayaran. Saldo dompet dijaga
// guardWalletBalances (advisory per dompet) persis seperti Pengeluaran biasa.

export interface PaymentRow {
  id: string; purchase_id: string; amount: string; date: string; wallet_id: string | null; expense_id: string | null;
  note: string; created_by: string | null; created_at: Date; voided: boolean; voided_at: Date | null;
}
export function rowToPayment(r: PaymentRow) {
  return {
    id: r.id, purchaseId: r.purchase_id, amount: Number(r.amount), date: r.date, walletId: r.wallet_id,
    expenseId: r.expense_id, note: r.note, createdBy: r.created_by, createdAt: r.created_at.toISOString(),
    voided: r.voided, voidedAt: r.voided_at ? r.voided_at.toISOString() : null,
  };
}

export const sumActivePayments = async (pgTx: PgTx, purchaseId: string): Promise<number> => {
  const [r] = await pgTx<{ s: string }[]>`select coalesce(sum(amount), 0) as s from material_purchase_payments where purchase_id = ${purchaseId} and not voided`;
  return Number(r.s) || 0;
};

export interface AddPaymentArgs {
  purchaseId: string;
  /** Mentah dari body; null = bayar SELURUH sisa (dipakai Tandai Lunas). */
  amount: unknown | null;
  date: string;
  walletId: string | null;
  note: string;
  actor: string;
}
export interface AddPaymentResult {
  before: ReturnType<typeof rowToPurchase>;
  paymentId: string | null; expenseId: string | null; amount: number;
  paidBefore: number; paidAfter: number; remainingAfter: number; settled: boolean;
}

// Satu pembayaran = satu baris `expenses` ('Bahan Baku', source_type 'material-purchase', source_id = pembelian)
// + satu baris material_purchase_payments. Kunci `for update` pada pembelian mencegah dua pembayaran serentak
// lolos terhadap sisa yang sama (overpay/dobel).
export async function addPurchasePaymentTx(pgTx: PgTx, a: AddPaymentArgs): Promise<AddPaymentResult> {
  const [row] = await pgTx<PurchaseRow[]>`select * from material_purchases where id = ${a.purchaseId} for update`;
  if (!row) throw new PaymentError('Pembelian tidak ditemukan.');
  if (row.voided) throw new PaymentError('Pembelian ini sudah dibatalkan dan tidak bisa dibayar.');
  if (row.payment_status === 'lunas') throw new PaymentError('Pembelian ini sudah lunas.');

  const paidBefore = await sumActivePayments(pgTx, a.purchaseId);
  const purchase = rowToPurchase({ ...row, paid_amount: String(paidBefore) });
  const remaining = remainingOf(purchase.total, paidBefore);
  if (remaining <= PAY_TOLERANCE) {
    // Sisa tinggal selisih pembulatan (atau total 0): Tandai Lunas cukup menutupnya tanpa pembayaran baru.
    if (a.amount !== null) throw new PaymentError('Tidak ada sisa hutang untuk dibayar.');
    await pgTx`update material_purchases set payment_status = 'lunas', updated_at = now() where id = ${a.purchaseId}`;
    return { before: purchase, paymentId: null, expenseId: null, amount: 0, paidBefore, paidAfter: paidBefore, remainingAfter: 0, settled: true };
  }
  const amount = a.amount === null ? remaining : validatePaymentAmount(a.amount, remaining);
  if (!a.walletId) throw new PaymentError('Dompet sumber wajib dipilih.');
  const [wallet] = await pgTx<{ id: string }[]>`select id from wallets where id = ${a.walletId}`;
  if (!wallet) throw new PaymentError('Dompet tidak ditemukan.');

  const paymentId = randomUUID();
  const expenseId = randomUUID();
  const itemNames = purchase.items.map(it => it.materialName).join(', ');
  const settled = settlesPurchase(remaining, amount);
  const noteText = `Pembayaran pembelian bahan baku (${itemNames})${a.note ? ` — ${a.note}` : ''}`;
  await guardWalletBalances(pgTx, [a.walletId], async () => {
    await pgTx`
      insert into expenses (id, category, description, amount, date, note, wallet_id, source_type, source_id, created_at, updated_at)
      values (${expenseId}, 'Bahan Baku', ${`Pembelian bahan baku - ${purchase.supplierName || 'Tanpa nama'}`}, ${amount}, ${a.date}, ${noteText}, ${a.walletId}, 'material-purchase', ${a.purchaseId}, now(), now())
    `;
  });
  await pgTx`
    insert into material_purchase_payments (id, purchase_id, amount, date, wallet_id, expense_id, note, created_by, created_at)
    values (${paymentId}, ${a.purchaseId}, ${amount}, ${a.date}, ${a.walletId}, ${expenseId}, ${a.note}, ${a.actor}, now())
  `;
  if (settled) await pgTx`update material_purchases set payment_status = 'lunas', updated_at = now() where id = ${a.purchaseId}`;
  else await pgTx`update material_purchases set updated_at = now() where id = ${a.purchaseId}`;
  return { before: purchase, paymentId, expenseId, amount, paidBefore, paidAfter: paidBefore + amount, remainingAfter: settled ? 0 : remainingOf(purchase.total, paidBefore + amount), settled };
}

export interface CancelPaymentResult {
  before: ReturnType<typeof rowToPurchase>;
  payment: ReturnType<typeof rowToPayment>;
  paidAfter: number; reopened: boolean;
}

// Batalkan satu cicilan: pengeluaran pasangannya dihapus (uang kembali ke dompet), baris pembayaran ditandai
// voided (jejak audit). Pembelian yang tadinya lunas karena cicilan ini kembali jadi belum lunas.
export async function cancelPurchasePaymentTx(pgTx: PgTx, purchaseId: string, paymentId: string): Promise<CancelPaymentResult> {
  const [row] = await pgTx<PurchaseRow[]>`select * from material_purchases where id = ${purchaseId} for update`;
  if (!row) throw new PaymentError('Pembelian tidak ditemukan.');
  if (row.voided) throw new PaymentError('Pembelian ini sudah dibatalkan; pembayarannya sudah ikut dibatalkan.');
  const purchase = rowToPurchase({ ...row, paid_amount: String(await sumActivePayments(pgTx, purchaseId)) });
  const [pay] = await pgTx<PaymentRow[]>`select * from material_purchase_payments where id = ${paymentId} and purchase_id = ${purchaseId} for update`;
  if (!pay) throw new PaymentError('Pembayaran tidak ditemukan.');
  if (pay.voided) throw new PaymentError('Pembayaran ini sudah dibatalkan.');

  if (pay.expense_id) await pgTx`delete from expenses where id = ${pay.expense_id}`;
  await pgTx`update material_purchase_payments set voided = true, voided_at = now(), expense_id = null where id = ${paymentId}`;
  const paidAfter = await sumActivePayments(pgTx, purchaseId);
  const reopened = purchase.paymentStatus === 'lunas' && remainingOf(purchase.total, paidAfter) > PAY_TOLERANCE;
  if (reopened) await pgTx`update material_purchases set payment_status = 'belum_lunas', updated_at = now() where id = ${purchaseId}`;
  else await pgTx`update material_purchases set updated_at = now() where id = ${purchaseId}`;
  return { before: purchase, payment: rowToPayment(pay), paidAfter, reopened };
}

// Dipakai void & hapus pembelian: pengeluaran semua cicilan aktif dihapus. `markVoided` = tandai barisnya voided
// (void pembelian, baris tetap ada); `false` = hapus barisnya (hapus pembelian). Mengembalikan jumlah cicilan yang dibereskan.
export async function removePurchasePaymentsTx(pgTx: PgTx, purchaseId: string, mode: 'void' | 'delete'): Promise<{ count: number; amount: number }> {
  const rows = await pgTx<PaymentRow[]>`select * from material_purchase_payments where purchase_id = ${purchaseId} and not voided for update`;
  const expenseIds = rows.map(r => r.expense_id).filter((x): x is string => !!x);
  if (expenseIds.length > 0) await pgTx`delete from expenses where id in ${pgTx(expenseIds)}`;
  if (mode === 'void') await pgTx`update material_purchase_payments set voided = true, voided_at = now(), expense_id = null where purchase_id = ${purchaseId} and not voided`;
  else await pgTx`delete from material_purchase_payments where purchase_id = ${purchaseId}`;
  return { count: rows.length, amount: rows.reduce((s, r) => s + Number(r.amount), 0) };
}
