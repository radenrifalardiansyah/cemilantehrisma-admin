import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | undefined;

// Singleton pooled connection ke Supabase Postgres (transaction-mode pooler, port 6543) —
// mirror pola getDb() di firebase-admin.ts. Reuse across warm serverless invocations supaya
// tidak buka koneksi baru tiap request.
export function getSql() {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL!, {
      prepare: false, // pgbouncer transaction mode tidak support prepared statements
    });
  }
  return sql;
}
