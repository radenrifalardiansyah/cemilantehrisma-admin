#!/usr/bin/env node
// One-time: biaya lain-lain pada Rekap Harian konsinyasi (biaya admin, ongkir, dll.) yang memotong
// total rekap. total_revenue tetap = netto; kolom baru menyimpan rincian & totalnya.
// Idempotent. Usage: node scripts/add-recap-other-costs.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const content = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^"(.*)"$/, '$1');
  }
}

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1 });
  await sql`alter table consignment_recaps add column if not exists other_costs jsonb not null default '[]'::jsonb`;
  await sql`alter table consignment_recaps add column if not exists total_other_costs numeric not null default 0`;
  console.log('OK  consignment_recaps.other_costs, total_other_costs');
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
