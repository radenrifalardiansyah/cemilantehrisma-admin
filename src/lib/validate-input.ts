import { wibDateKey } from '@/lib/date';

// Jumlah uang dari body request: harus angka berhingga, dibulatkan ke 2 desimal (cukup untuk
// Rupiah), dan dibatasi supaya tidak melampaui presisi kolom numeric database. Mengembalikan null
// kalau tidak valid — pemanggil lazimnya cukup `?? 0` lalu memakai cek "harus lebih dari 0" yang
// sudah ada, jadi Infinity/NaN/teks ditolak dengan 400, bukan jadi 500 dari database.
const MAX_AMOUNT = 1e13;

export function parseMoneyAmount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > MAX_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}

// Tanggal 'YYYY-MM-DD' (hari kalender, bukan timestamp) — format yang dipakai semua filter periode
// yang membandingkan string secara leksikal, jadi "5/10/2026" atau "2026-1-5" akan menghasilkan
// baris yang tak pernah muncul di filter mana pun tapi tetap terhitung di saldo.
// Kosong → hari ini (WIB) kalau `defaultToday`, selain itu null. Tidak valid → null.
export function parseDateKey(v: unknown, defaultToday = true): string | null {
  if (v === undefined || v === null || v === '') return defaultToday ? wibDateKey(new Date()) : null;
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return v;
}
