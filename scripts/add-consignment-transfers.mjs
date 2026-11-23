#!/usr/bin/env node
// One-time (Mitra > Transfer Stok): dokumen pindah stok antar mitra/lokasi konsinyasi, tanpa lewat gudang/toko.
// Tabel consignment_transfers: draft -> approved | ditolak; approved -> dibatalkan (soft cancel).
// Efek stok (consignment_stock) hanya terjadi saat approve (dan dibalik saat cancel) — diatur di aplikasi.
// Idempoten (create table / index if not exists). Usage: node scripts/add-consignment-transfers.mjs
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
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1, onnotice: () => {} });
  await sql.begin(async tx => {
    await tx`
      create table if not exists consignment_transfers (
        id text primary key,
        doc_number text not null unique,
        from_location_id text not null references consignment_locations(id) on delete restrict,
        to_location_id text not null references consignment_locations(id) on delete restrict,
        from_location_name text not null default '',
        to_location_name text not null default '',
        items jsonb not null default '[]'::jsonb,
        note text not null default '',
        doc_date timestamptz not null default now(),
        status text not null default 'draft' check (status in ('draft', 'approved', 'ditolak', 'dibatalkan')),
        created_by text,
        approved_by text,
        approved_at timestamptz,
        rejected_by text,
        rejected_at timestamptz,
        reject_reason text,
        cancelled_by text,
        cancelled_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz,
        constraint consignment_transfers_from_to_check check (from_location_id <> to_location_id)
      )
    `;
    await tx`alter table consignment_transfers enable row level security`;
    console.log('OK  tabel consignment_transfers (RLS aktif)');
    await tx`create index if not exists idx_ct_from on consignment_transfers (from_location_id)`;
    await tx`create index if not exists idx_ct_to on consignment_transfers (to_location_id)`;
    await tx`create index if not exists idx_ct_status_date on consignment_transfers (status, doc_date)`;
    await tx`create index if not exists idx_ct_created_at on consignment_transfers (created_at desc)`;
    console.log('OK  index from/to location, status+doc_date, created_at');
  });
  await sql.end();
}

main().catch(err => { console.error('GAGAL:', err.message); process.exit(1); });
