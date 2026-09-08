#!/usr/bin/env node
// One-time: tambah kolom `consignment_locations.logo_url` — logo mitra/lapak yang diunggah
// manual lewat menu Mitra > Lokasi, ditampilkan sebagai thumbnail menggantikan ikon generik
// di list & nota PDF.
// Usage: node scripts/add-consignment-location-logo.mjs
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

  await sql`alter table consignment_locations add column if not exists logo_url text`;
  console.log('OK  column consignment_locations.logo_url');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
