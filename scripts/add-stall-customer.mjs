#!/usr/bin/env node
// One-time (Kasir Lapak): nama & WhatsApp pelanggan opsional di penjualan lapak (untuk struk via WhatsApp).
// Aman diulang.
// Usage: node scripts/add-stall-customer.mjs
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
  await sql`alter table stall_sales add column if not exists customer_name text not null default ''`;
  await sql`alter table stall_sales add column if not exists customer_phone text not null default ''`;
  console.log('OK  stall_sales.customer_name / customer_phone');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
