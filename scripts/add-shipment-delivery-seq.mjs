#!/usr/bin/env node
// One-time: nomor urutan pengiriman per pengiriman stok mitra (consignment_shipments.delivery_seq, integer nullable).
// Dipakai mengurutkan mitra di pesan WA "Rencana Kirim". Null = belum diberi urutan (tampil paling bawah).
// Idempoten (add column if not exists), data lama tetap valid.
// Usage: node scripts/add-shipment-delivery-seq.mjs
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
  await sql`alter table consignment_shipments add column if not exists delivery_seq integer`;
  console.log('OK  column consignment_shipments.delivery_seq');
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
