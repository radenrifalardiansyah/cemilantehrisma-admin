#!/usr/bin/env node
// One-time: fitur Purchase Order (PO) & Penerimaan Barang (GR/DO) untuk Bahan Baku.
// Alur: PO (draft → terkirim) → GR (draft → approved | dibatalkan) → saat approve baru masuk
// ke `material_purchases` (stok + pengeluaran). Pembelian manual tidak berubah (source = 'manual').
// Idempotent. Usage: node scripts/add-po-gr.mjs
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

  // Penghitung nomor dokumen per jenis+periode (mis. 'PO-202610'), dinaikkan di dalam transaksi.
  await sql`
    create table if not exists doc_counters (
      key text primary key,
      last_value integer not null default 0
    )
  `;
  await sql`alter table doc_counters enable row level security`;
  console.log('OK  table doc_counters');

  await sql`
    create table if not exists purchase_orders (
      id text primary key,
      po_number text not null unique,
      supplier_id text references suppliers(id) on delete restrict,
      supplier_name text not null default '',
      supplier_phone text not null default '',
      items jsonb not null default '[]'::jsonb,
      total numeric not null default 0,
      date text not null,
      expected_date text,
      note text not null default '',
      status text not null default 'draft',
      token text not null,
      sent_at timestamptz,
      cancel_note text,
      created_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz
    )
  `;
  await sql`create index if not exists purchase_orders_created_at_idx on purchase_orders (created_at desc)`;
  await sql`create index if not exists purchase_orders_supplier_idx on purchase_orders (supplier_id)`;
  await sql`alter table purchase_orders enable row level security`;
  console.log('OK  table purchase_orders');

  await sql`
    create table if not exists goods_receipts (
      id text primary key,
      gr_number text not null unique,
      do_number text not null unique,
      supplier_do_number text not null default '',
      po_id text not null references purchase_orders(id) on delete restrict,
      items jsonb not null default '[]'::jsonb,
      total numeric not null default 0,
      received_date text not null,
      note text not null default '',
      status text not null default 'draft',
      wallet_id text,
      payment_status text,
      purchase_id text,
      token text not null,
      created_by text,
      approved_by text,
      approved_at timestamptz,
      cancelled_at timestamptz,
      cancel_note text,
      created_at timestamptz not null default now(),
      updated_at timestamptz
    )
  `;
  await sql`create index if not exists goods_receipts_po_idx on goods_receipts (po_id)`;
  await sql`create index if not exists goods_receipts_created_at_idx on goods_receipts (created_at desc)`;
  await sql`alter table goods_receipts enable row level security`;
  console.log('OK  table goods_receipts');

  await sql`alter table material_purchases add column if not exists po_id text`;
  await sql`alter table material_purchases add column if not exists gr_id text`;
  await sql`alter table material_purchases add column if not exists source text not null default 'manual'`;
  console.log('OK  columns material_purchases.po_id / gr_id / source');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
