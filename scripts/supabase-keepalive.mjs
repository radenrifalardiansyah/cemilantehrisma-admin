#!/usr/bin/env node
// Ping database supaya project Supabase (free tier) tidak di-pause karena 7 hari tanpa aktivitas.
// Dipanggil oleh .github/workflows/supabase-keepalive.yml tiap minggu.
import postgres from 'postgres';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL tidak di-set (perlu GitHub secret DATABASE_URL)');
  }

  const sql = postgres(connectionString, { prepare: false, max: 1 });
  try {
    const [{ now }] = await sql`select now()`;
    console.log(`Supabase keepalive OK — ${now}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('Supabase keepalive gagal:', err);
  process.exit(1);
});
