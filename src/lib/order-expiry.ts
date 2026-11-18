// Kedaluwarsa pesanan website yang belum dibayar. Aturan bisnis: batas 24 jam sejak pesanan dibuat;
// pesanan yang SUDAH upload bukti bayar dikecualikan (admin yang memutuskan). Dipakai cron
// /api/cron/expire-unpaid-orders dan penanda "Kedaluwarsa" di menu Pesanan — satu sumber kebenaran.
export const UNPAID_ORDER_EXPIRY_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** Batas waktu: pesanan yang dibuat SEBELUM nilai ini (ms epoch) sudah kedaluwarsa. */
export function expiryCutoffMs(nowMs: number = Date.now()): number {
  return nowMs - UNPAID_ORDER_EXPIRY_HOURS * HOUR_MS;
}

export function expiryCutoff(now: Date = new Date()): Date {
  return new Date(expiryCutoffMs(now.getTime()));
}

/** True bila pesanan dibuat lebih dari 24 jam lalu (tepat 24 jam belum dianggap lewat). */
export function isOrderExpired(createdAtMs: number, nowMs: number = Date.now()): boolean {
  return Number.isFinite(createdAtMs) && createdAtMs < expiryCutoffMs(nowMs);
}

export interface ExpirableOrderState {
  source?: string | null;
  status: string;
  paymentStatus?: string | null;
  transferProofUrl?: string | null;
  /** Konservatif: apa pun yang sudah diisi (diproses/dikirim/siap_diambil) berarti pesanan sudah ditangani. */
  fulfillmentStatus?: string | null;
  createdAtMs: number;
}

/**
 * Pesanan website yang layak dibatalkan otomatis. Cek syarat yang tidak butuh DB; syarat lain
 * (tanpa cicilan, belum Closing) dicek di route dengan query. Dipakai di query kandidat DAN dicek ulang
 * di dalam transaksi (setelah row lock) supaya aman dari race dengan admin/pelanggan.
 */
export function isExpirableUnpaidOrder(o: ExpirableOrderState, nowMs: number = Date.now()): boolean {
  return o.source === 'portal'
    && o.status === 'baru'
    && o.paymentStatus === 'belum_lunas'
    && !(o.transferProofUrl ?? '').trim()
    && !o.fulfillmentStatus
    && isOrderExpired(o.createdAtMs, nowMs);
}
