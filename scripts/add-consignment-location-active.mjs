#!/usr/bin/env node
// One-time: tambah kolom `consignment_locations.is_active` — status mitra aktif/nonaktif.
// Default TRUE untuk semua mitra yang sudah ada. Mitra nonaktif tidak muncul di pilihan form
// Kirim Stok & Rekap, tapi riwayat dan laporannya tetap ada. Aman diulang.
// Usage: node scripts/add-consignment-location-active.mjs
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
await sql`alter table consignment_locations add column if not exists is_active boolean not null default true`;
console.log('OK  consignment_locations.is_active');
await sql.end();
