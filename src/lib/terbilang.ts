// Angka -> kalimat bahasa Indonesia untuk kolom "Terbilang" di dokumen (PO, GR, invoice).
// 225000 -> "dua ratus dua puluh lima ribu rupiah". Pembulatan ke rupiah penuh.
const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function baca(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  if (n < 100) return `${SATUAN[Math.floor(n / 10)]} puluh${n % 10 ? ` ${SATUAN[n % 10]}` : ''}`;
  if (n < 200) return `seratus${n - 100 ? ` ${baca(n - 100)}` : ''}`;
  if (n < 1000) return `${SATUAN[Math.floor(n / 100)]} ratus${n % 100 ? ` ${baca(n % 100)}` : ''}`;
  if (n < 2000) return `seribu${n - 1000 ? ` ${baca(n - 1000)}` : ''}`;
  if (n < 1_000_000) return `${baca(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${baca(n % 1000)}` : ''}`;
  if (n < 1_000_000_000) return `${baca(Math.floor(n / 1_000_000))} juta${n % 1_000_000 ? ` ${baca(n % 1_000_000)}` : ''}`;
  if (n < 1_000_000_000_000) return `${baca(Math.floor(n / 1_000_000_000))} miliar${n % 1_000_000_000 ? ` ${baca(n % 1_000_000_000)}` : ''}`;
  return `${baca(Math.floor(n / 1_000_000_000_000))} triliun${n % 1_000_000_000_000 ? ` ${baca(n % 1_000_000_000_000)}` : ''}`;
}

export function terbilangRupiah(amount: number): string {
  const n = Math.round(Math.abs(Number(amount) || 0));
  if (!Number.isFinite(n)) return '';
  const words = n === 0 ? 'nol' : baca(n);
  return `${amount < 0 ? 'minus ' : ''}${words} rupiah`;
}
