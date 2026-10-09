#!/usr/bin/env node
// One-time: buat tabel modul "Titip Jual" (pihak luar menitipkan barang ke lapak kita):
//   stalls               — lapak (entitas sendiri, opsional menunjuk ke gudang)
//   consignors           — penitip
//   consign_products     — produk titipan (default skema bagi hasil + harga jual)
//   consign_stall_items  — produk × lapak: harga jual, stok, override skema bagi hasil
//   consign_receipts     — dokumen terima barang / retur ke penitip
//   consign_stock_ledger — riwayat pergerakan stok titipan per lapak
// Skema bagi hasil: 'nominal' (harga setor tetap ke penitip) atau 'commission' (persen komisi untuk kita).
// Aman diulang (if not exists).
// Usage: node scripts/create-consign.mjs
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

  await sql`
    create table if not exists stalls (
      id text primary key,
      code text,
      name text not null,
      address text not null default '',
      warehouse_id text,
      note text not null default '',
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz
    )
  `;
  console.log('OK  table stalls');

  await sql`
    create table if not exists consignors (
      id text primary key,
      code text,
      name text not null,
      phone text not null default '',
      address text not null default '',
      bank_name text not null default '',
      bank_account text not null default '',
      bank_holder text not null default '',
      note text not null default '',
      scheme text check (scheme in ('nominal', 'commission')),
      scheme_value numeric not null default 0 check (scheme_value >= 0),
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz
    )
  `;
  // NULL = "Belum ditentukan": produk penitip ini wajib punya skema sendiri. (Perubahan setelah
  // rilis awal — aman diulang.)
  await sql`alter table consignors alter column scheme drop not null`;
  await sql`alter table consignors add column if not exists logo_url text`;
  console.log('OK  table consignors');

  // scheme/scheme_value NULL = ikut default penitip.
  await sql`
    create table if not exists consign_products (
      id text primary key,
      code text,
      consignor_id text not null references consignors(id),
      name text not null,
      unit text not null default 'pcs',
      default_price numeric not null default 0 check (default_price >= 0),
      scheme text check (scheme in ('nominal', 'commission')),
      scheme_value numeric check (scheme_value >= 0),
      note text not null default '',
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz
    )
  `;
  await sql`create index if not exists consign_products_consignor_idx on consign_products (consignor_id)`;
  console.log('OK  table consign_products');

  // price/scheme/scheme_value NULL = ikut default produk (lalu default penitip).
  await sql`
    create table if not exists consign_stall_items (
      id text primary key,
      product_id text not null references consign_products(id),
      stall_id text not null references stalls(id),
      price numeric check (price >= 0),
      scheme text check (scheme in ('nominal', 'commission')),
      scheme_value numeric check (scheme_value >= 0),
      stock_qty numeric not null default 0 check (stock_qty >= 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz,
      unique (product_id, stall_id)
    )
  `;
  await sql`create index if not exists consign_stall_items_stall_idx on consign_stall_items (stall_id)`;
  console.log('OK  table consign_stall_items');

  await sql`
    create table if not exists consign_receipts (
      id text primary key,
      doc_number text not null,
      kind text not null check (kind in ('in', 'return')),
      consignor_id text not null references consignors(id),
      consignor_name text not null,
      stall_id text not null references stalls(id),
      stall_name text not null,
      doc_date text not null,
      items jsonb not null default '[]'::jsonb,
      total_qty numeric not null default 0,
      note text not null default '',
      created_by text,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists consign_receipts_consignor_idx on consign_receipts (consignor_id, created_at desc)`;
  console.log('OK  table consign_receipts');

  await sql`
    create table if not exists consign_stock_ledger (
      id text primary key,
      product_id text not null,
      product_name text not null,
      stall_id text not null,
      stall_name text not null,
      type text not null,
      qty numeric not null,
      balance_after numeric not null,
      receipt_id text,
      note text not null default '',
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists consign_stock_ledger_product_idx on consign_stock_ledger (product_id, created_at desc)`;
  console.log('OK  table consign_stock_ledger');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
