#!/usr/bin/env node
// One-time: approval Purchase Order — kolom `approved_by` & `approved_at`. Alur baru:
// draft → disetujui (approve) → terkirim (kirim WA) → diterima*. GR baru bisa dibuat setelah PO
// disetujui. PO lama yang sudah terkirim/diterima tidak diubah (tetap bisa dibuatkan GR).
// Idempotent. Usage: node scripts/add-po-approval.mjs
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
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1 });
  await sql`alter table purchase_orders add column if not exists approved_by text`;
  await sql`alter table purchase_orders add column if not exists approved_at timestamptz`;
  console.log('OK  purchase_orders.approved_by / approved_at');
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
