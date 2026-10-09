#!/usr/bin/env node
// One-time (Kasir Lapak): retur sebagian penjualan.
//   stall_sales.refund_total       — total uang yang sudah dikembalikan lewat retur (omzet bersih = total − refund_total)
//   stall_sale_returns             — dokumen retur (item yang diretur, nilai refund, alasan)
//   consign_sale_lines.return_id   — baris bagi hasil NEGATIF akibat retur barang titipan
// Aman diulang.
// Usage: node scripts/add-stall-returns.mjs
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
  await sql`alter table stall_sales add column if not exists refund_total numeric not null default 0`;
  await sql`
    create table if not exists stall_sale_returns (
      id text primary key,
      doc_number text not null unique,
      sale_id text not null references stall_sales(id),
      stall_id text not null,
      items jsonb not null default '[]'::jsonb,
      refund_amount numeric not null,
      reason text not null default '',
      created_by text,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists stall_sale_returns_sale_idx on stall_sale_returns (sale_id)`;
  await sql`alter table consign_sale_lines add column if not exists return_id text`;
  console.log('OK  stall_sales.refund_total + stall_sale_returns + consign_sale_lines.return_id');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
