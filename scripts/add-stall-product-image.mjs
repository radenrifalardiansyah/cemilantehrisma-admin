#!/usr/bin/env node
// One-time (Titip Jual):
//   consign_products.image_url     — gambar produk titipan (tampil di Kasir Lapak & daftar produk)
//   stalls.show_own_products       — apakah Kasir Lapak menampilkan produk TOKO dari gudang terkait.
//                                    Lapak yang sudah ada tetap true (perilaku lama dipertahankan);
//                                    lapak baru default false (hanya barang yang memang dimasukkan).
// Aman diulang (if not exists).
// Usage: node scripts/add-stall-product-image.mjs
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
  await sql`alter table consign_products add column if not exists image_url text`;
  console.log('OK  column consign_products.image_url');
  const [{ had }] = await sql`select exists(select 1 from information_schema.columns where table_name = 'stalls' and column_name = 'show_own_products') as had`;
  if (!had) {
    await sql`alter table stalls add column show_own_products boolean not null default true`;
    await sql`alter table stalls alter column show_own_products set default false`;
    console.log('OK  column stalls.show_own_products (lapak lama = true, lapak baru default false)');
  } else console.log('SKIP stalls.show_own_products sudah ada');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
