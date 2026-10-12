#!/usr/bin/env node
// One-time: stalls.show_in_storefront — lapak yang tampil di menu "Lapak" website (hanya lihat produk & stok, tanpa
// transaksi). Default TRUE untuk semua lapak; matikan per lapak di Titip Jual → Lapak. Aman diulang.
// Usage: node scripts/add-stall-storefront-flag.mjs
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
await sql`alter table stalls add column if not exists show_in_storefront boolean not null default true`;
console.log('OK  stalls.show_in_storefront');
await sql.end();
