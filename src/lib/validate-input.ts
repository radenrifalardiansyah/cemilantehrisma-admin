import { wibDateKey } from '@/lib/date';

// parseMoneyAmount dipindah ke money-input.ts (murni, aman untuk bundel browser); diekspor ulang di sini
// supaya semua pemanggil server yang sudah ada tidak berubah.
export { parseMoneyAmount } from '@/lib/money-input';

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
