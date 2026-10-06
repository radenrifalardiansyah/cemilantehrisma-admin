// Aturan cicilan pesanan kredit — murni (tanpa database) supaya bisa diuji dan dipakai bersama
// oleh server (sumber kebenaran) dan layar Pesanan (pratinjau).

export interface InstallmentState {
  total: number;
  paid: number;
  remaining: number;
  isPaidOff: boolean;
}

export function installmentState(total: number, paid: number): InstallmentState {
  const remaining = Math.max(0, total - paid);
  return { total, paid, remaining, isPaidOff: paid >= total };
}

// Pesan error (siap tampil) atau null kalau jumlah pembayaran boleh dicatat. Tidak boleh melebihi
// sisa tagihan — kelebihan bayar harus ditangani terpisah (mis. retur), bukan diam-diam tercatat.
export function paymentProblem(total: number, paid: number, amount: unknown): string | null {
  const n = Number(amount);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return 'Jumlah pembayaran harus bilangan bulat lebih dari 0.';
  const { remaining } = installmentState(total, paid);
  if (remaining <= 0) return 'Pesanan ini sudah lunas.';
  if (n > remaining) return `Jumlah melebihi sisa tagihan (Rp${remaining.toLocaleString('id-ID')}).`;
  return null;
}
