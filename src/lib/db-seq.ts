// Jalankan beberapa query Postgres BERURUTAN (satu per satu) tapi dengan bentuk pakai-ulang seperti
// Promise.all: `const [a, b] = await seq([sql`...`, sql`...`])`.
//
// Kenapa: lewat PgBouncer (pooler Supabase, transaction mode) query yang menumpuk di satu koneksi
// (lebih banyak query bersamaan daripada `max` koneksi di src/lib/db.ts, atau beberapa request
// bersamaan di instance yang sama) bisa macet total — bukan cuma lambat. Terbukti: laporan lapak yang
// menjalankan 7 query sekaligus loading tanpa henti. Query postgres.js bersifat lazy (baru jalan saat
// di-await), jadi menunggunya satu per satu benar-benar membuat mereka berjalan berurutan.
// Dipakai di route yang menjalankan lebih dari 2 query independen; harganya hanya beberapa ratus ms.
export async function seq<T extends readonly [PromiseLike<unknown>, ...PromiseLike<unknown>[]]>(queries: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const out: unknown[] = [];
  for (const q of queries) out.push(await q);
  return out as { -readonly [K in keyof T]: Awaited<T[K]> };
}
