#!/usr/bin/env node
// One-time (Kasir Lapak): catatan "Update Stok" yang dikirim ke grup WhatsApp penitip — hanya waktu & pengirim,
// dipakai sebagai batas "terjual/masuk sejak update sebelumnya". Aman diulang.
// Usage: node scripts/add-stall-stock-updates.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1, onnotice: () => {} });
await sql`
  create table if not exists stall_stock_updates (
    id text primary key,
    stall_id text not null references stalls(id),
    created_by text,
    created_at timestamptz not null default now()
  )
`;
await sql`create index if not exists stall_stock_updates_stall_idx on stall_stock_updates (stall_id, created_at desc)`;
console.log('OK  stall_stock_updates');
await sql.end();
