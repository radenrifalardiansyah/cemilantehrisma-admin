#!/usr/bin/env node
// One-time (Titip Jual): pindah stok titipan antar lapak — dokumen memakai tabel consign_receipts
// dengan kind 'transfer' (stall_id = lapak asal) + to_stall_id/to_stall_name (lapak tujuan).
// Aman diulang.
// Usage: node scripts/add-consign-transfer.mjs
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
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3, onnotice: () => {} });
  // Ganti check kind: ('in','return') → ('in','return','transfer')
  const cons = await sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'consign_receipts'::regclass and contype = 'c'`;
  for (const c of cons) if (/kind/.test(c.def)) await sql.unsafe(`alter table consign_receipts drop constraint "${c.conname}"`);
  await sql`alter table consign_receipts add constraint consign_receipts_kind_check check (kind in ('in', 'return', 'transfer'))`;
  await sql`alter table consign_receipts add column if not exists to_stall_id text references stalls(id)`;
  await sql`alter table consign_receipts add column if not exists to_stall_name text`;
  console.log('OK  consign_receipts: kind transfer + to_stall_id/to_stall_name');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
