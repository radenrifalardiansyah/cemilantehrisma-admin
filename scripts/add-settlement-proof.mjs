#!/usr/bin/env node
// One-time (Titip Jual): foto bukti pembayaran rekap ke penitip (URL gambar). Aman diulang.
// Usage: node scripts/add-settlement-proof.mjs
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
await sql`alter table consign_settlements add column if not exists pay_proof_url text not null default ''`;
console.log('OK  consign_settlements.pay_proof_url');
await sql.end();
