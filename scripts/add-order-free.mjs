#!/usr/bin/env node
// One-time: tambah kolom `orders.is_free` + `orders.free_reason` — penanda transaksi GRATIS
// (barang diberikan tanpa bayar: sample, kompensasi, tester, dll) yang dipilih eksplisit kasir,
// terpisah dari diskon. Dipakai badge "Gratis" di Pesanan & kolom Gratis di Laporan Produk.
// Data lama: order kasir dengan total Rp0 (dulu digratiskan lewat diskon 100%) ikut ditandai gratis.
// Usage: node scripts/add-order-free.mjs
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

  await sql`alter table orders add column if not exists is_free boolean not null default false`;
  await sql`alter table orders add column if not exists free_reason text`;
  console.log('OK  columns orders.is_free, orders.free_reason');

  const res = await sql`
    update orders set is_free = true, free_reason = coalesce(free_reason, 'Diskon 100% (data lama)')
    where is_free = false and total = 0 and subtotal > 0 and source = 'kasir' and status <> 'dibatalkan'
  `;
  console.log(`OK  backfill transaksi lama bertotal Rp0: ${res.count} baris`);

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
