#!/usr/bin/env node
// One-time (Titip Jual): stok opname & penyesuaian stok titipan (rusak/hilang/kadaluarsa/selisih hitung).
//   consign_adjustments       — dokumen penyesuaian per lapak
//   consign_sale_lines        — sale_id jadi nullable + adjustment_id + source ('sale'|'loss'): kerugian yang
//                               DITANGGUNG TOKO menjadi baris 'loss' (kompensasi ke penitip) yang ikut rekap
// Aman diulang.
// Usage: node scripts/add-consign-adjustments.mjs
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
  await sql`
    create table if not exists consign_adjustments (
      id text primary key,
      doc_number text not null unique,
      kind text not null check (kind in ('opname', 'damage', 'lost', 'expired', 'other')),
      stall_id text not null references stalls(id),
      stall_name text not null,
      bearer text not null default 'none' check (bearer in ('toko', 'penitip', 'none')),
      doc_date text not null,
      items jsonb not null default '[]'::jsonb,
      total_delta numeric not null default 0,
      total_compensation numeric not null default 0,
      note text not null default '',
      created_by text,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists consign_adjustments_stall_idx on consign_adjustments (stall_id, created_at desc)`;
  await sql`alter table consign_sale_lines alter column sale_id drop not null`;
  await sql`alter table consign_sale_lines add column if not exists adjustment_id text`;
  await sql`alter table consign_sale_lines add column if not exists source text not null default 'sale'`;
  const cons = await sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'consign_sale_lines'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source%'`;
  if (cons.length === 0) await sql`alter table consign_sale_lines add constraint consign_sale_lines_source_check check (source in ('sale', 'loss'))`;
  await sql`create index if not exists consign_sale_lines_adjustment_idx on consign_sale_lines (adjustment_id)`;
  console.log('OK  consign_adjustments + consign_sale_lines (sale_id nullable, adjustment_id, source)');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
