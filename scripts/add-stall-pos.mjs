#!/usr/bin/env node
// One-time (Titip Jual tahap 2B): Kasir Lapak — data penjualan lapak, TERPISAH dari `orders` toko.
//   stall_shifts      — sesi kasir per lapak (satu shift terbuka per lapak)
//   stall_sales       — penjualan lapak (invoice berawalan lapak)
//   consign_sale_lines— baris bagi hasil barang titipan yang terjual (dasar rekap bayar ke penitip)
// Aman diulang (if not exists).
// Usage: node scripts/add-stall-pos.mjs
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
    create table if not exists stall_shifts (
      id text primary key,
      stall_id text not null references stalls(id),
      opened_by text,
      opening_balance numeric not null default 0,
      note text not null default '',
      status text not null default 'open' check (status in ('open', 'closed')),
      opened_at timestamptz not null default now(),
      closed_at timestamptz,
      closed_by text,
      cash_sales_total numeric,
      expected_balance numeric,
      actual_balance numeric,
      difference numeric,
      close_note text
    )
  `;
  // Satu shift terbuka per lapak — ditegakkan database, bukan baca-lalu-tulis.
  await sql`create unique index if not exists stall_shifts_one_open_idx on stall_shifts (stall_id) where status = 'open'`;
  console.log('OK  table stall_shifts');

  await sql`
    create table if not exists stall_sales (
      id text primary key,
      invoice_no text not null unique,
      stall_id text not null references stalls(id),
      stall_name text not null,
      shift_id text references stall_shifts(id),
      date text not null,
      cashier text,
      items jsonb not null default '[]'::jsonb,
      subtotal numeric not null,
      discount numeric not null default 0,
      total numeric not null,
      payment_method text not null check (payment_method in ('cash', 'qris', 'transfer')),
      amount_paid numeric not null,
      change_amount numeric not null default 0,
      note text not null default '',
      status text not null default 'paid' check (status in ('paid', 'void')),
      void_reason text,
      voided_by text,
      voided_at timestamptz,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists stall_sales_stall_idx on stall_sales (stall_id, created_at desc)`;
  await sql`create index if not exists stall_sales_shift_idx on stall_sales (shift_id)`;
  console.log('OK  table stall_sales');

  await sql`
    create table if not exists consign_sale_lines (
      id text primary key,
      sale_id text not null references stall_sales(id),
      stall_id text not null,
      consignor_id text not null,
      consignor_name text not null,
      product_id text not null,
      product_name text not null,
      qty numeric not null,
      price numeric not null,
      scheme text not null,
      scheme_value numeric not null default 0,
      consignor_amount numeric not null,
      our_amount numeric not null,
      voided boolean not null default false,
      settlement_id text,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists consign_sale_lines_sale_idx on consign_sale_lines (sale_id)`;
  await sql`create index if not exists consign_sale_lines_consignor_idx on consign_sale_lines (consignor_id, created_at desc)`;
  console.log('OK  table consign_sale_lines');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
