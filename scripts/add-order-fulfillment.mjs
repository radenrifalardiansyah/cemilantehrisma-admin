#!/usr/bin/env node
// One-time: tambah kolom status layanan/pengiriman pesanan website di `orders`:
//   fulfillment_status text  — 'diproses' | 'dikirim' | 'siap_diambil' (null = menunggu konfirmasi / data lama)
//   shipping_courier   text  — nama kurir (daftar tetap, lihat src/lib/shipping-couriers.ts)
//   tracking_no        text  — nomor resi
// Semua nullable: pesanan lama tetap valid. Kolom `status` (baru|selesai|dibatalkan) tidak berubah.
// Idempoten (add column if not exists), aman dijalankan berulang.
// Usage: node scripts/add-order-fulfillment.mjs
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

  await sql`alter table orders add column if not exists fulfillment_status text`;
  console.log('OK  column orders.fulfillment_status');
  await sql`alter table orders add column if not exists shipping_courier text`;
  console.log('OK  column orders.shipping_courier');
  await sql`alter table orders add column if not exists tracking_no text`;
  console.log('OK  column orders.tracking_no');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
