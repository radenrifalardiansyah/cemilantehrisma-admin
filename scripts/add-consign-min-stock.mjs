#!/usr/bin/env node
// One-time (Titip Jual): batas stok menipis per produk titipan. 0 = tidak dipantau.
// Notifikasi hanya dikirim saat stok di sebuah lapak BARU melewati batas (tanpa cron).
// Aman diulang (if not exists).
// Usage: node scripts/add-consign-min-stock.mjs
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
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3, onnotice: () => {} });
  await sql`alter table consign_products add column if not exists min_stock numeric not null default 0 check (min_stock >= 0)`;
  console.log('OK  column consign_products.min_stock');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
