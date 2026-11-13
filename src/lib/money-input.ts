// Jumlah uang dari body request: harus angka berhingga, dibulatkan ke 2 desimal (cukup untuk
// Rupiah), dan dibatasi supaya tidak melampaui presisi kolom numeric database. Mengembalikan null
// kalau tidak valid — pemanggil lazimnya cukup `?? 0` lalu memakai cek "harus lebih dari 0" yang
// sudah ada, jadi Infinity/NaN/teks ditolak dengan 400, bukan jadi 500 dari database.
//
// File ini SENGAJA murni (tanpa import): dipakai juga oleh modul yang ikut terbundel ke browser
// (mis. closing-settlement-core.ts via WalletsTab). Jangan mengimpor apa pun yang menarik firebase-admin
// atau modul Node (date.ts, db, dsb.) ke sini.
const MAX_AMOUNT = 1e13;

export function parseMoneyAmount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > MAX_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}
