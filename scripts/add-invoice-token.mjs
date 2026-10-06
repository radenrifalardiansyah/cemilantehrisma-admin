#!/usr/bin/env node
// One-time: tambah kolom `invoices.token` — token acak yang jadi bagian link PDF invoice publik
// (/api/invoice/<no>?t=<token>), supaya nomor invoice yang berurutan tidak bisa ditebak untuk
// membuka invoice orang lain. Nullable: invoice lama tanpa token tetap bisa dibuka (link yang
// sudah terkirim ke pelanggan tidak putus).
// Usage: node scripts/add-invoice-token.mjs
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

  await sql`alter table invoices add column if not exists token text`;
  console.log('OK  column invoices.token');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
