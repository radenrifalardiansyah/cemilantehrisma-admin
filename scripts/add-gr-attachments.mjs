#!/usr/bin/env node
// One-time: lampiran foto pada Penerimaan Barang (GR/DO) — kolom `attachments` (array URL gambar).
// Idempotent. Usage: node scripts/add-gr-attachments.mjs
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
  await sql`alter table goods_receipts add column if not exists attachments jsonb not null default '[]'::jsonb`;
  console.log('OK  goods_receipts.attachments');
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
