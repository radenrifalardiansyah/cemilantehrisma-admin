#!/usr/bin/env node
// One-time: buat tabel `vouchers` + kolom `orders.voucher_code` (kode voucher yang dipakai pesanan,
// dipakai untuk melepas kuota saat pesanan dibatalkan/dihapus). Aman diulang (if not exists).
// Usage: node scripts/create-vouchers.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^"(.*)"$/, '$1');
  }
}

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

  await sql`
    create table if not exists vouchers (
      code text primary key,
      description text,
      type text not null check (type in ('percent', 'nominal')),
      value numeric not null check (value > 0),
      min_purchase numeric not null default 0,
      max_discount numeric not null default 0,
      valid_from text,
      valid_until text,
      usage_limit integer not null default 0,
      used_count integer not null default 0,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz
    )
  `;
  console.log('OK  table vouchers');
  await sql`alter table orders add column if not exists voucher_code text`;
  console.log('OK  column orders.voucher_code');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
