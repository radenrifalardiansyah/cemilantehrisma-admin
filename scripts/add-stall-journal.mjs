#!/usr/bin/env node
// One-time (Titip Jual): jurnal kas lapak lengkap.
//   stall_wallet_entries.kind  += 'shift_diff'  (selisih kas saat tutup shift, tercatat otomatis)
//   stall_wallet_entries.category               (kategori kas manual: modal, setor ke toko, operasional, dst)
// Aman diulang.
// Usage: node scripts/add-stall-journal.mjs
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
  const cons = await sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'stall_wallet_entries'::regclass and contype = 'c'`;
  for (const c of cons) if (/kind/.test(c.def)) await sql.unsafe(`alter table stall_wallet_entries drop constraint "${c.conname}"`);
  await sql`alter table stall_wallet_entries add constraint stall_wallet_entries_kind_check check (kind in ('opening', 'manual', 'sale', 'payout', 'shift_diff'))`;
  await sql`alter table stall_wallet_entries add column if not exists category text not null default ''`;
  await sql`create index if not exists stall_wallet_entries_created_idx on stall_wallet_entries (created_at)`;
  console.log('OK  stall_wallet_entries: kind shift_diff + category');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
