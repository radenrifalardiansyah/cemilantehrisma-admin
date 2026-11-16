import { randomUUID } from 'crypto';
import type { PgTx } from '@/lib/doc-number';
import { wibDateKey } from '@/lib/date';
import { guardWalletBalances } from '@/lib/wallet-balance';
import { latestActiveClosing, paidAtProblem, recapOwnClosingLock, recapPaymentClosingLock } from '@/lib/closing';
import { rowToRecap, type RecapRow } from '@/lib/recaps-pg';
import { PAY_TOLERANCE, PaymentError, remainingOf, settlesRecap, validateRecapPaymentAmount } from '@/lib/recap-payments-core';

// Akses DB untuk pembayaran/cicilan Rekap Mitra. Semua fungsi jalan di dalam transaksi `pgTx` milik pemanggil.
// Bagian murni (status, toleransi, validasi) ada di recap-payments-core.ts.
//
// Urutan kunci: baris consignment_recaps (for update) -> (saat batal) baris pembayaran -> advisory dompet
// (guardWalletBalances). Uang rekap berpindah ke dompet LANGSUNG dari baris pembayaran (tidak ada baris income/expenses
// pasangan): saldo dompet menjumlah consignment_recap_payments aktif, lihat wallet-balance.ts & wallets/balances.

export interface RecapPaymentRow {
  id: string; recap_id: string; amount: string; paid_at: Date; wallet_id: string | null; note: string;
  created_by: string | null; created_at: Date; voided: boolean; voided_at: Date | null; closing_id: string | null;
}
export function rowToRecapPayment(r: RecapPaymentRow) {
  return {
    id: r.id, recapId: r.recap_id, amount: Number(r.amount), paidAt: r.paid_at.toISOString(), date: wibDateKey(r.paid_at),
    walletId: r.wallet_id, note: r.note ?? '', createdBy: r.created_by, createdAt: r.created_at.toISOString(),
    voided: r.voided, voidedAt: r.voided_at ? r.voided_at.toISOString() : null, closed: !!r.closing_id,
  };
}

export const sumActiveRecapPayments = async (pgTx: PgTx, recapId: string): Promise<number> => {
  const [r] = await pgTx<{ s: string }[]>`select coalesce(sum(amount), 0) as s from consignment_recap_payments where recap_id = ${recapId} and not voided`;
  return Number(r.s) || 0;
};

export interface AddRecapPaymentArgs {
  recapId: string;
  /** Mentah dari body; null = bayar SELURUH sisa (dipakai PATCH "bayar sisa"). */
  amount: unknown | null;
  paidAt: Date;
  walletId: string | null;
  /** false = dompet boleh kosong (hanya PATCH lama: uang masuk ke bucket "Belum Ditentukan"). */
  requireWallet: boolean;
  note: string;
  actor: string;
}
export interface AddRecapPaymentResult {
  before: ReturnType<typeof rowToRecap>;
  paymentId: string | null; amount: number;
  paidBefore: number; paidAfter: number; remainingAfter: number; settled: boolean;
}

// Satu pembayaran = satu baris consignment_recap_payments. Kunci `for update` pada rekap mencegah dua pembayaran
// serentak lolos terhadap sisa yang sama (overpay/dobel). Saat sisa <= toleransi rekap otomatis 'lunas',
// paid_at = tanggal pembayaran pelunas (dasar tanggal bayar di Closing), wallet_id = dompet pembayaran pelunas.
export async function addRecapPaymentTx(pgTx: PgTx, a: AddRecapPaymentArgs): Promise<AddRecapPaymentResult> {
  const [row] = await pgTx<RecapRow[]>`select * from consignment_recaps where id = ${a.recapId} for update`;
  if (!row) throw new PaymentError('Rekap tidak ditemukan.');
  if (row.payment_status === 'lunas') throw new PaymentError('Rekap ini sudah lunas.');
  const lockMsg = await recapOwnClosingLock(pgTx, a.recapId);
  if (lockMsg) throw new PaymentError(lockMsg);

  const paidBefore = await sumActiveRecapPayments(pgTx, a.recapId);
  const recap = rowToRecap(row);
  const remaining = remainingOf(recap.totalRevenue, paidBefore);

  const walletId: string | null = a.walletId;
  if (!walletId) {
    if (a.requireWallet) throw new PaymentError('Dompet tujuan wajib dipilih.');
  } else {
    const [wallet] = await pgTx<{ id: string; is_active: boolean | null }[]>`select id, is_active from wallets where id = ${walletId}`;
    if (!wallet) throw new PaymentError('Dompet tidak ditemukan.');
    if (wallet.is_active === false) throw new PaymentError('Dompet tidak aktif.');
  }

  // Tanggal bayar tidak boleh di masa depan / sebelum closing terakhir (pembayaran "mundur" ke periode yang sudah ditutup tak akan ikut closing mana pun).
  const latest = await latestActiveClosing(pgTx);
  const dateMsg = paidAtProblem(a.paidAt, new Date(), latest?.period_to ?? null);
  if (dateMsg) throw new PaymentError(dateMsg);

  if (remaining <= PAY_TOLERANCE) {
    // Sisa tinggal selisih pembulatan (atau total 0): "bayar sisa" cukup menutupnya tanpa pembayaran baru.
    if (a.amount !== null) throw new PaymentError('Tidak ada sisa piutang untuk dibayar.');
    await pgTx`update consignment_recaps set payment_status = 'lunas', wallet_id = ${walletId}, paid_at = ${a.paidAt}, updated_at = now() where id = ${a.recapId}`;
    return { before: recap, paymentId: null, amount: 0, paidBefore, paidAfter: paidBefore, remainingAfter: 0, settled: true };
  }
  const amount = a.amount === null ? remaining : validateRecapPaymentAmount(a.amount, remaining);
  const paymentId = randomUUID();
  const settled = settlesRecap(remaining, amount);
  await pgTx`
    insert into consignment_recap_payments (id, recap_id, amount, paid_at, wallet_id, note, created_by, created_at)
    values (${paymentId}, ${a.recapId}, ${amount}, ${a.paidAt}, ${walletId}, ${a.note}, ${a.actor}, now())
  `;
  if (settled) await pgTx`update consignment_recaps set payment_status = 'lunas', wallet_id = ${walletId}, paid_at = ${a.paidAt}, updated_at = now() where id = ${a.recapId}`;
  else await pgTx`update consignment_recaps set updated_at = now() where id = ${a.recapId}`;
  return { before: recap, paymentId, amount, paidBefore, paidAfter: paidBefore + amount, remainingAfter: settled ? 0 : remainingOf(recap.totalRevenue, paidBefore + amount), settled };
}

export interface CancelRecapPaymentResult {
  before: ReturnType<typeof rowToRecap>;
  payment: ReturnType<typeof rowToRecapPayment>;
  paidAfter: number; reopened: boolean;
}

// Batalkan satu pembayaran: uang keluar lagi dari dompet (ditolak kalau saldo jadi minus), baris ditandai voided
// (jejak audit). Rekap yang tadinya lunas karena pembayaran ini kembali belum lunas (paid_at & wallet_id dikosongkan).
// Pembayaran yang sudah masuk Closing tidak bisa dibatalkan.
export async function cancelRecapPaymentTx(pgTx: PgTx, recapId: string, paymentId: string): Promise<CancelRecapPaymentResult> {
  const [row] = await pgTx<RecapRow[]>`select * from consignment_recaps where id = ${recapId} for update`;
  if (!row) throw new PaymentError('Rekap tidak ditemukan.');
  const recap = rowToRecap(row);
  const [pay] = await pgTx<RecapPaymentRow[]>`select * from consignment_recap_payments where id = ${paymentId} and recap_id = ${recapId} for update`;
  if (!pay) throw new PaymentError('Pembayaran tidak ditemukan.');
  if (pay.voided) throw new PaymentError('Pembayaran ini sudah dibatalkan.');
  const lockMsg = await recapPaymentClosingLock(pgTx, paymentId);
  if (lockMsg) throw new PaymentError(lockMsg);

  await guardWalletBalances(pgTx, [pay.wallet_id], async () => {
    await pgTx`update consignment_recap_payments set voided = true, voided_at = now() where id = ${paymentId}`;
  });
  const paidAfter = await sumActiveRecapPayments(pgTx, recapId);
  const reopened = recap.paymentStatus === 'lunas' && remainingOf(recap.totalRevenue, paidAfter) > PAY_TOLERANCE;
  if (reopened) await pgTx`update consignment_recaps set payment_status = 'belum_lunas', paid_at = null, wallet_id = null, updated_at = now() where id = ${recapId}`;
  else await pgTx`update consignment_recaps set updated_at = now() where id = ${recapId}`;
  return { before: recap, payment: rowToRecapPayment(pay), paidAfter, reopened };
}

// Dipakai saat rekap dihapus: semua baris pembayaran (aktif maupun voided) dihapus supaya FK RESTRICT tidak menghalangi.
// Dompet pembayaran AKTIF dijaga saldonya (uang keluar lagi) — pemanggil membungkus dengan guardWalletBalances memakai
// `activeRecapPaymentWallets`. Mengembalikan jumlah baris aktif yang dibereskan.
export async function activeRecapPaymentWallets(pgTx: PgTx, recapId: string): Promise<string[]> {
  const rows = await pgTx<{ wallet_id: string | null }[]>`select distinct wallet_id from consignment_recap_payments where recap_id = ${recapId} and not voided`;
  return rows.map(r => r.wallet_id).filter((w): w is string => !!w);
}
export async function deleteRecapPaymentsTx(pgTx: PgTx, recapId: string): Promise<{ count: number; amount: number }> {
  const rows = await pgTx<RecapPaymentRow[]>`select * from consignment_recap_payments where recap_id = ${recapId} for update`;
  await pgTx`delete from consignment_recap_payments where recap_id = ${recapId}`;
  const active = rows.filter(r => !r.voided);
  return { count: active.length, amount: active.reduce((s, r) => s + Number(r.amount), 0) };
}
