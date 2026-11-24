#!/usr/bin/env node
// One-time: pengaturan tampilan mode Desktop per pengguna (profiles.ui_appearance, jsonb nullable).
// Isi: { accent, wallpaper, density, textSize } (divalidasi di API). Null = belum memilih (default).
// Idempoten (add column if not exists), data lama tetap valid.
// Usage: node scripts/add-profile-ui-appearance.mjs
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
  await sql`alter table profiles add column if not exists ui_appearance jsonb`;
  console.log('OK  column profiles.ui_appearance');
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
