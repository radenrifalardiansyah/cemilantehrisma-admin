#!/usr/bin/env node
// One-time: menu yang disematkan (pin) ke tampilan depan Desktop per pengguna (profiles.ui_pins, jsonb nullable).
// Isi: array id tab berurutan sesuai urutan disematkan (divalidasi di API). Null = belum memilih (memakai pintasan bawaan).
// Idempoten (add column if not exists), data lama tetap valid.
// Usage: node scripts/add-profile-ui-pins.mjs
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
  await sql`alter table profiles add column if not exists ui_pins jsonb`;
  console.log('OK  column profiles.ui_pins');
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
