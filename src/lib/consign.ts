// Logika bagi hasil Titip Jual — murni (tanpa import server), dipakai server (API/penjualan) dan
// klien (pratinjau di form). Dua skema:
//   'nominal'    — harga setor tetap per unit ke penitip; selisihnya jadi bagian kita.
//   'commission' — persen komisi untuk kita dari harga jual; sisanya untuk penitip.

export type ShareScheme = 'nominal' | 'commission';

export interface SchemeSpec { scheme: ShareScheme; value: number }

// Satu tingkat konfigurasi; scheme/value null artinya "ikut tingkat di atasnya".
export interface SchemeLevel { scheme: ShareScheme | null; value: number | null }

export const SCHEME_LABEL: Record<ShareScheme, string> = {
  nominal: 'Harga setor (nominal)',
  commission: 'Komisi (persen)',
};

// Tingkat diurutkan dari yang paling spesifik (produk di lapak) ke paling umum (default penitip).
// Skema dan nilainya dipilih sebagai satu paket dari tingkat pertama yang mengisi scheme —
// jangan campur skema satu tingkat dengan nilai tingkat lain (nilai 10.000 vs 15% tidak sepadan).
// Mengembalikan null kalau tidak ada satu tingkat pun yang menentukan skema (penitip "Belum
// ditentukan" dan produk/lapak tidak mengisi) — pemanggil harus menolak/menandai kasus ini, jangan
// diam-diam menganggap harga setor Rp0.
export function resolveScheme(levels: (SchemeLevel | null | undefined)[]): SchemeSpec | null {
  for (const l of levels) {
    if (l && l.scheme) return { scheme: l.scheme, value: l.value ?? 0 };
  }
  return null;
}

export interface ShareResult { consignor: number; ours: number }

// Bagian per 1 unit. Pembulatan ke rupiah penuh; sisa pembulatan selalu jatuh ke penitip agar
// consignor + ours === price tanpa selisih.
export function calcShare(price: number, spec: SchemeSpec): ShareResult {
  if (spec.scheme === 'commission') {
    const ours = Math.round(price * spec.value / 100);
    return { ours, consignor: price - ours };
  }
  return { consignor: spec.value, ours: price - spec.value };
}

// Pesan error validasi, atau null jika valid. `price` opsional: kalau diketahui, skema nominal
// tidak boleh melebihi harga jual (kita tidak boleh rugi per unit).
export function validateScheme(scheme: ShareScheme, value: number, price?: number): string | null {
  if (!Number.isFinite(value) || value < 0) return 'Nilai bagi hasil tidak valid.';
  if (scheme === 'commission' && value > 100) return 'Komisi tidak boleh lebih dari 100%.';
  if (scheme === 'nominal' && price !== undefined && price > 0 && value > price) {
    return 'Harga setor tidak boleh lebih besar dari harga jual.';
  }
  return null;
}

export function schemeText(spec: SchemeSpec | null): string {
  if (!spec) return 'Skema belum ditentukan';
  return spec.scheme === 'commission'
    ? `Komisi ${spec.value}%`
    : `Setor Rp${Math.round(spec.value).toLocaleString('id-ID')}`;
}

export function isShareScheme(v: unknown): v is ShareScheme {
  return v === 'nominal' || v === 'commission';
}
