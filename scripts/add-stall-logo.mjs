#!/usr/bin/env node
// One-time: stalls.logo_url — logo lapak (Cloudinary), tampil di admin dan menu Lapak website. Aman diulang.
// Usage: node scripts/add-stall-logo.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1, onnotice: () => {} });
await sql`alter table stalls add column if not exists logo_url text`;
console.log('OK  stalls.logo_url');
await sql.end();
