#!/usr/bin/env node
// One-time: kolom di `stock_ledger` untuk selisih stok opname yang masuk Laporan Keuangan:
//   unit_cost — Harga Modal (HPP) per unit saat opname, supaya nilai kerugian/keuntungan stok bisa dihitung
//   kind      — penanda jenis entri ("opname"); null untuk entri stok biasa
// Keduanya opsional: entri lama tidak berubah. Aman diulang.
// Usage: node scripts/add-stock-ledger-opname-cols.mjs
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

  await sql`alter table stock_ledger add column if not exists unit_cost numeric`;
  await sql`alter table stock_ledger add column if not exists kind text`;
  console.log('OK  stock_ledger.unit_cost, stock_ledger.kind');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
