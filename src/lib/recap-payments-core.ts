import { PAY_TOLERANCE, PaymentError, derivePaymentState, formatRupiah, remainingOf, type PaymentState } from '@/lib/payables-core';
import { parseMoneyAmount } from '@/lib/money-input';

// Bagian MURNI (tanpa DB/server/firebase) pembayaran sebagian Rekap Mitra — aman dipakai di klien dan diuji langsung.
// Akses DB-nya ada di src/lib/recap-payments.ts.
//
// Model (sama dengan Hutang Supplier / cicilan Pesanan): rekap belum lunas dicicil lewat tabel
// `consignment_recap_payments`. Status DITURUNKAN dari total_revenue vs jumlah pembayaran aktif; kolom
// consignment_recaps.payment_status tetap 'belum_lunas' | 'lunas' (pembaca lama tak rusak) dan baru jadi 'lunas'
// saat sisa <= toleransi. Rekap lunas lama (tanpa baris pembayaran) = lunas penuh.

export { PAY_TOLERANCE, PaymentError, remainingOf };
export type { PaymentState };

const EPS = 0.005;
const r2 = (n: number) => Math.round(n * 100) / 100;

// Status sebuah rekap: kolom 'lunas' (termasuk rekap lunas lama tanpa baris pembayaran) = lunas; selain itu diturunkan.
export function recapPaymentState(r: { paymentStatus?: string | null; total: number; paid: number }): PaymentState {
  if ((r.paymentStatus ?? 'lunas') === 'lunas') return 'lunas';
  return derivePaymentState(r.total, r.paid);
}

// Sisa piutang: rekap 'lunas' selalu 0 (rekap lunas lama tak punya baris pembayaran); selain itu total - dibayar.
export function recapRemaining(r: { paymentStatus?: string | null; total: number; paid: number }): number {
  if ((r.paymentStatus ?? 'lunas') === 'lunas') return 0;
  return remainingOf(r.total, r.paid);
}

// Nominal satu pembayaran harus > 0 dan tidak melebihi sisa (selisih lebih = diskon lewat "Biaya lain-lain", bukan bayar lebih).
export function validateRecapPaymentAmount(raw: unknown, remaining: number): number {
  const amount = parseMoneyAmount(raw);
  if (amount === null || amount <= 0) throw new PaymentError('Nominal pembayaran harus lebih dari 0.');
  if (amount > remaining + EPS) throw new PaymentError(`Nominal melebihi sisa piutang (${formatRupiah(remaining)}).`);
  return amount;
}

// Pembayaran ini melunasi? (sisa setelah bayar <= toleransi)
export const settlesRecap = (remaining: number, amount: number) => remaining - amount <= PAY_TOLERANCE + EPS;

// Tanggal bayar (yyyy-mm-dd WIB) -> momen penyimpanan. Hari ini = sekarang (urutan antar pembayaran hari itu tetap benar);
// hari lain = tengah hari WIB (sama dengan OrdersTab: `${date}T12:00:00+07:00`).
export function paidAtFromDate(date: string, now: Date): Date {
  const today = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  return date === today ? now : new Date(`${date}T12:00:00+07:00`);
}

// ── Pengakuan pendapatan berbasis kas (Laporan Keuangan / Dashboard / Analitik Bulanan) ──────────────
// Rekap yang punya pembayaran diakui PER PEMBAYARAN (tanggal uang diterima), sebanding dengan nominalnya:
// pendapatan kotor, biaya lain-lain, qty, dan HPP semuanya dikali rasio = nominal / total_revenue (netto).
// Hasilnya berbentuk "rekap semu" yang bisa langsung dijumlahkan seperti rekap lunas biasa.
export interface RecapReportItem { productId?: string; productName?: string; qtySold: number; revenue?: number; hargaTitip?: number; costPrice?: number }
export interface RecapReportSource {
  totalRevenue: number; // netto (setelah biaya lain-lain)
  otherCosts: { label: string; amount: number }[]; totalOtherCosts: number;
  items: RecapReportItem[];
}
export interface RecapPaymentRecord {
  recapId: string; locationName: string; walletId: string | null;
  amount: number; paidAtSeconds: number;
  totalRevenue: number; // = amount (netto yang diterima)
  otherCosts: { label: string; amount: number }[]; totalOtherCosts: number;
  items: RecapReportItem[]; // qtySold & revenue sudah dikali rasio
}

export const recapPaymentRatio = (amount: number, total: number) => (total > 0 ? Math.min(1, amount / total) : 0);

export function scaleRecapForPayment(src: RecapReportSource, amount: number): Pick<RecapPaymentRecord, 'totalRevenue' | 'otherCosts' | 'totalOtherCosts' | 'items'> {
  const ratio = recapPaymentRatio(amount, src.totalRevenue);
  return {
    totalRevenue: amount,
    otherCosts: src.otherCosts.map(c => ({ label: c.label, amount: r2(c.amount * ratio) })),
    totalOtherCosts: r2(src.totalOtherCosts * ratio),
    items: src.items.map(it => ({
      ...it,
      qtySold: it.qtySold * ratio,
      revenue: it.revenue !== undefined ? it.revenue * ratio : undefined,
    })),
  };
}
