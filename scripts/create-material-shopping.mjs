#!/usr/bin/env node
// One-time: buat tabel `material_shopping_items` — Daftar Belanja bahan baku (dibuat sebelum
// belanja ke toko/warung, dicentang saat dibeli, lalu diproses jadi pembelian bahan baku).
// Usage: node scripts/create-material-shopping.mjs
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
    create table if not exists material_shopping_items (
      id text primary key,
      material_id text not null references raw_materials(id) on delete cascade,
      qty numeric not null check (qty > 0),
      price numeric,
      note text,
      checked boolean not null default false,
      status text not null default 'pending',
      purchase_id text,
      created_by text,
      created_at timestamptz not null default now(),
      done_at timestamptz
    )
  `;
  await sql`create index if not exists material_shopping_status_idx on material_shopping_items (status, created_at)`;
  console.log('OK  table material_shopping_items');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
