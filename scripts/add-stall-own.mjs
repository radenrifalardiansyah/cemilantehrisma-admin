#!/usr/bin/env node
// One-time (Produk Toko di Lapak): toko "menitipkan" produknya ke lapak dan menagih hasil jualannya.
//   stall_product_prices   — harga jual produk toko per lapak (kosong = harga toko)
//   stall_shipments        — dokumen Kirim ke Lapak / Retur ke Gudang / Saldo Awal (stok yang sudah ada)
//   stall_own_lines        — baris penjualan produk toko (dasar setoran lapak ke toko); retur = baris negatif
//   stall_own_settlements  — rekap setoran: unpaid -> paid (dibayar dari dompet lapak, jadi Pemasukan toko)
// Aman diulang.
// Usage: node scripts/add-stall-own.mjs
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

await sql`
  create table if not exists stall_product_prices (
    stall_id text not null references stalls(id),
    product_id text not null,
    price numeric not null check (price >= 0),
    updated_at timestamptz not null default now(),
    primary key (stall_id, product_id)
  )
`;
await sql`
  create table if not exists stall_shipments (
    id text primary key,
    doc_number text not null unique,
    kind text not null check (kind in ('send', 'return', 'opening')),
    stall_id text not null references stalls(id),
    stall_name text not null,
    from_warehouse_id text,
    from_warehouse_name text not null default '',
    doc_date text not null,
    items jsonb not null default '[]'::jsonb,
    total_qty numeric not null default 0,
    total_value numeric not null default 0,
    note text not null default '',
    status text not null default 'active' check (status in ('active', 'void')),
    created_by text,
    created_at timestamptz not null default now(),
    voided_by text,
    voided_at timestamptz
  )
`;
await sql`create index if not exists stall_shipments_stall_idx on stall_shipments (stall_id, created_at desc)`;
await sql`
  create table if not exists stall_own_settlements (
    id text primary key,
    doc_number text not null unique,
    stall_id text not null references stalls(id),
    stall_name text not null,
    period_from text not null,
    period_to text not null,
    total_amount numeric not null default 0,
    lines_count integer not null default 0,
    items jsonb not null default '[]'::jsonb,
    status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
    note text not null default '',
    wallet_id text,
    income_id text,
    created_by text,
    created_at timestamptz not null default now(),
    paid_at timestamptz,
    paid_by text
  )
`;
await sql`create index if not exists stall_own_settlements_stall_idx on stall_own_settlements (stall_id, created_at desc)`;
await sql`
  create table if not exists stall_own_lines (
    id text primary key,
    sale_id text not null,
    stall_id text not null references stalls(id),
    product_id text not null,
    product_name text not null,
    qty numeric not null,
    price numeric not null,
    amount numeric not null,
    return_id text,
    voided boolean not null default false,
    settlement_id text,
    created_at timestamptz not null default now()
  )
`;
await sql`create index if not exists stall_own_lines_stall_idx on stall_own_lines (stall_id, created_at)`;
await sql`create index if not exists stall_own_lines_sale_idx on stall_own_lines (sale_id)`;
await sql`create index if not exists stall_own_lines_settlement_idx on stall_own_lines (settlement_id)`;
console.log('OK  stall_product_prices, stall_shipments, stall_own_settlements, stall_own_lines');
await sql.end();
