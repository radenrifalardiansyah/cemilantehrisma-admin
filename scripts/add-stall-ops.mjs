#!/usr/bin/env node
// One-time (Titip Jual tahap 2A): operasional lapak.
//   stalls.invoice_prefix     — awalan nomor invoice penjualan lapak (beda dari nota toko)
//   stall_users               — petugas (akun) yang ditugaskan ke lapak
//   stall_wallet_entries      — buku kas/dompet per lapak (saldo = jumlah seluruh entri;
//                               terpisah total dari tabel `wallets` milik toko)
// Aman diulang (if not exists).
// Usage: node scripts/add-stall-ops.mjs
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

  await sql`alter table stalls add column if not exists invoice_prefix text`;
  // Lapak yang sudah ada: awalan invoice default = kodenya (LPK001).
  await sql`update stalls set invoice_prefix = code where invoice_prefix is null and code is not null`;
  console.log('OK  column stalls.invoice_prefix');

  await sql`
    create table if not exists stall_users (
      stall_id text not null references stalls(id),
      username text not null,
      created_at timestamptz not null default now(),
      primary key (stall_id, username)
    )
  `;
  await sql`create index if not exists stall_users_username_idx on stall_users (username)`;
  console.log('OK  table stall_users');

  await sql`
    create table if not exists stall_wallet_entries (
      id text primary key,
      stall_id text not null references stalls(id),
      kind text not null check (kind in ('opening', 'manual', 'sale', 'payout')),
      amount numeric not null,
      ref_id text,
      note text not null default '',
      created_by text,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists stall_wallet_entries_stall_idx on stall_wallet_entries (stall_id, created_at desc)`;
  console.log('OK  table stall_wallet_entries');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
