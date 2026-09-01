import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | undefined;

// Singleton pooled connection ke Supabase Postgres (transaction-mode pooler, port 6543) —
// mirror pola getDb() di firebase-admin.ts. Reuse across warm serverless invocations supaya
// tidak buka koneksi baru tiap request.
export function getSql() {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL!, {
      prepare: false, // pgbouncer transaction mode tidak support prepared statements
      // postgres.js defaultnya buka sampai 10 koneksi PER instance serverless — lewat pooler
      // transaksi Supabase (PgBouncer) itu boros, karena pooling sesungguhnya sudah ditangani
      // di sisi Supabase; rekomendasi resminya 1 koneksi per instance untuk pola serverless
      // begini (banyak instance singkat, bukan 1 server long-lived). Query paralel
      // (Promise.all beberapa `sql\`...\``) tetap benar dengan ini, cuma dijalankan bergiliran
      // lewat 1 koneksi alih-alih benar-benar bersamaan — bedanya cuma beberapa ms.
      max: 1,
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
