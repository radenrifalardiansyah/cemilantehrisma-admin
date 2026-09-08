#!/usr/bin/env node
// One-time: tambah kolom `wallets.bank_name` — nama bank dari master data (dipilih lewat
// dropdown di form Dompet saat Tipe = Bank), terpisah dari `wallets.name` yang bebas isi
// (mis. "BCA Sindy"). Mengikuti konvensi `bankName` di AdminFeeTab/ResellersTab: simpan
// nama bank apa adanya (string), bukan FK ke master_banks.code.
// Usage: node scripts/add-wallet-bank-name.mjs
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

  await sql`alter table wallets add column if not exists bank_name text`;
  console.log('OK  column wallets.bank_name');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
