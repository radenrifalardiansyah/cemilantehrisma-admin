import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | undefined;

// Singleton pooled connection ke Supabase Postgres (transaction-mode pooler, port 6543) —
// mirror pola getDb() di firebase-admin.ts. Reuse across warm serverless invocations supaya
// tidak buka koneksi baru tiap request.
export function getSql() {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL!, {
      prepare: false, // pgbouncer transaction mode tidak support prepared statements
      // postgres.js defaultnya buka sampai 10 koneksi PER instance serverless, boros lewat
      // pooler transaksi Supabase. Sempat dicoba `max: 1` (rekomendasi umum untuk pola
      // serverless+pgbouncer), TAPI itu ternyata bikin request hang tanpa batas waktu:
      // Promise.all beberapa `sql\`...\`` di satu koneksi mengandalkan pipelining postgres.js,
      // dan pipelining itu terbukti macet total lewat PgBouncer transaction-mode Supabase (bukan
      // cuma jadi lebih lambat, benar-benar tidak pernah selesai — sempat kejadian di production).
      // 5 terbukti aman (query konkuren dapat koneksi sendiri-sendiri, tidak perlu pipelining)
      // sekaligus jauh lebih hemat dibanding default 10.
      max: 5,
    });
  }
  return sql;
}

// Lewat Supabase pooler (pgbouncer transaction mode), kolom jsonb kadang balik sebagai string JSON
// mentah alih-alih object/array ter-parse otomatis (quirk pooler, bukan hal yang bisa diandalkan) —
// dipakai di setiap tempat yang baca kolom jsonb (mis. `income.items`, `role_permissions.permissions`)
// supaya hasilnya selalu object/array asli terlepas dari perilaku itu.
export function parseJsonb<T>(value: T | string | null): T | null {
  if (value === null) return null;
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}
