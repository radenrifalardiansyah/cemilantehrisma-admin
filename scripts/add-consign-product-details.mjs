#!/usr/bin/env node
// One-time (Titip Jual): detail produk titipan seperti produk toko.
//   consign_products.category     — id kategori dari master Kategori (sama dengan produk toko); '' = tanpa kategori
//   consign_products.weight       — berat/ukuran, teks bebas (mis. "150g", "250 ml")
//   consign_products.description  — deskripsi / detail produk
// Aman diulang (if not exists).
// Usage: node scripts/add-consign-product-details.mjs
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
  await sql`alter table consign_products add column if not exists category text not null default ''`;
  await sql`alter table consign_products add column if not exists weight text not null default ''`;
  await sql`alter table consign_products add column if not exists description text not null default ''`;
  console.log('OK  columns consign_products.category / weight / description');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
