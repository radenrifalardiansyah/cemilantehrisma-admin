#!/usr/bin/env node
// One-time: fitur "Status transfer closing" (Closing HPP <-> Dompet).
//  Tabel penghubung `closing_settlements`: satu baris = sebagian/seluruh sebuah transfer antar dompet
//  (wallet_transfers) yang dialokasikan untuk menutup HPP sebuah closing.
//   - closing_id         FK -> closings(id)         ON DELETE RESTRICT
//   - wallet_transfer_id FK -> wallet_transfers(id) ON DELETE RESTRICT (aplikasi melepas tautan dulu saat transfer dihapus)
//   - amount numeric > 0, unik per (closing_id, wallet_transfer_id)
//  Tabel ini TIDAK mempengaruhi saldo dompet (computeWalletBalance tidak membacanya).
//  Status transfer closing (belum/sebagian/sudah) diturunkan di aplikasi, tidak disimpan.
// Aditif & idempoten (IF NOT EXISTS); tidak mengubah tabel lain; tidak ada backfill.
// Usage: node scripts/add-closing-settlements.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1 });

await sql.begin(async tx => {
  await tx`
    create table if not exists closing_settlements (
      id text primary key,
      closing_id text not null references closings(id) on delete restrict,
      wallet_transfer_id text not null references wallet_transfers(id) on delete restrict,
      amount numeric not null check (amount > 0),
      created_at timestamptz not null default now(),
      created_by text,
      constraint uq_closing_settlements_pair unique (closing_id, wallet_transfer_id)
    )
  `;
  console.log('OK  tabel closing_settlements');
  await tx`create index if not exists idx_closing_settlements_closing on closing_settlements (closing_id)`;
  await tx`create index if not exists idx_closing_settlements_transfer on closing_settlements (wallet_transfer_id)`;
  console.log('OK  index closing_id & wallet_transfer_id');
});
await sql.end();
