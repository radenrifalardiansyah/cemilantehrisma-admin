#!/usr/bin/env node
// One-time: tambah kolom `expenses.exclude_from_pnl` — pengeluaran yang tetap mengurangi saldo
// dompet & muncul di Jurnal Kas, tapi TIDAK dihitung sebagai Beban Operasional di Laba Rugi
// (mis. penyesuaian pembukuan). Default false → semua data lama tidak berubah.
// Usage: node scripts/add-expense-exclude-pnl.mjs
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

  await sql`alter table expenses add column if not exists exclude_from_pnl boolean not null default false`;
  console.log('OK  column expenses.exclude_from_pnl');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
