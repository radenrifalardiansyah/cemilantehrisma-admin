#!/usr/bin/env node
// One-time (Titip Jual tahap 2D): rekap bagi hasil & pembayaran ke penitip.
//   consign_settlements — dokumen rekap (per lapak × penitip × periode); baris penjualan yang
//                         masuk rekap ditandai lewat consign_sale_lines.settlement_id
// Status: 'unpaid' (rekap dibuat, belum dibayar) → 'paid' (dibayar dari dompet lapak).
// Aman diulang (if not exists).
// Usage: node scripts/add-consign-settlements.mjs
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
    create table if not exists consign_settlements (
      id text primary key,
      doc_number text not null unique,
      stall_id text not null references stalls(id),
      stall_name text not null,
      consignor_id text not null references consignors(id),
      consignor_name text not null,
      period_from text not null,
      period_to text not null,
      total_amount numeric not null,
      lines_count integer not null default 0,
      items jsonb not null default '[]'::jsonb,
      status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
      note text not null default '',
      created_by text,
      created_at timestamptz not null default now(),
      paid_at timestamptz,
      paid_by text
    )
  `;
  await sql`create index if not exists consign_settlements_idx on consign_settlements (stall_id, consignor_id, created_at desc)`;
  await sql`create index if not exists consign_sale_lines_settlement_idx on consign_sale_lines (settlement_id)`;
  console.log('OK  table consign_settlements');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
