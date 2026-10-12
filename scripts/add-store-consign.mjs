#!/usr/bin/env node
// One-time (Titipan di Kasir toko): barang titipan bisa dijual lewat Kasir toko biasa.
//   stalls.is_store         — satu lapak bertanda "Toko": menampung stok titipan yang dijual di Kasir toko
//   stall_sales.order_id    — penjualan titipan tertaut ke pesanan toko (satu keranjang, satu pembayaran)
//   stall_sales.pos_shift_id— sesi Kasir toko tempat uang tunai titipan masuk laci (untuk tutup shift)
// Aman diulang.
// Usage: node scripts/add-store-consign.mjs
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
await sql`alter table stalls add column if not exists is_store boolean not null default false`;
await sql`create unique index if not exists stalls_one_store_idx on stalls (is_store) where is_store`;
await sql`alter table stall_sales add column if not exists order_id text`;
await sql`alter table stall_sales add column if not exists pos_shift_id text`;
await sql`create index if not exists stall_sales_order_idx on stall_sales (order_id) where order_id is not null`;
await sql`create index if not exists stall_sales_pos_shift_idx on stall_sales (pos_shift_id) where pos_shift_id is not null`;
console.log('OK  stalls.is_store, stall_sales.order_id, stall_sales.pos_shift_id');
await sql.end();
