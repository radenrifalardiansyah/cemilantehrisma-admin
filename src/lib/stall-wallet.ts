// Kategori entri kas manual dompet lapak. Daftar tetap: nilai dipakai server (validasi) & UI (label).
export const WALLET_CATEGORIES = [
  { value: 'modal', label: 'Modal / tambah kas', dir: 'in' },
  { value: 'setoran', label: 'Setoran dari toko', dir: 'in' },
  { value: 'setor_toko', label: 'Setor ke toko', dir: 'out' },
  { value: 'operasional', label: 'Belanja operasional', dir: 'out' },
  { value: 'gaji', label: 'Gaji / uang makan petugas', dir: 'out' },
  { value: 'lain', label: 'Lain-lain', dir: 'both' },
] as const;

export const WALLET_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(WALLET_CATEGORIES.map(c => [c.value, c.label]));
export const isWalletCategory = (v: unknown): v is string => typeof v === 'string' && WALLET_CATEGORIES.some(c => c.value === v);

export const WALLET_KIND_LABEL: Record<string, string> = {
  opening: 'Saldo awal', manual: 'Kas manual', sale: 'Penjualan', payout: 'Bayar penitip', shift_diff: 'Selisih kas shift',
};
