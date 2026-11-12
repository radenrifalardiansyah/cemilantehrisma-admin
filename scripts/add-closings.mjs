#!/usr/bin/env node
// One-time: fitur Closing HPP (Laporan Produk).
//  1. Tabel `closings` — satu baris per closing (periode, total HPP/omzet snapshot, status aktif/dibuka_ulang).
//  2. Kolom `closing_id` (nullable, FK → closings, ON DELETE RESTRICT) di `orders`, `order_payments`, `consignment_recaps`.
//     - order_payments.closing_id : tiap penerimaan uang cicilan (HPP diakui proporsional per pembayaran).
//     - orders.closing_id         : HANYA untuk pesanan lunas tanpa baris cicilan (lunas sekaligus).
//     - consignment_recaps.closing_id : rekap konsinyasi lunas.
//  3. Kolom `paid_at` (timestamptz, nullable) di `orders` & `consignment_recaps` — tanggal pelunasan lewat
//     "Tandai Lunas" tanpa cicilan. Null = dianggap lunas saat dibuat (dipakai created_at). Sengaja BUKAN baris
//     order_payments sintetis: saldo dompet & Laporan Keuangan memperlakukan pesanan ber-cicilan lewat
//     order_payments (bukan orders.total), jadi baris sintetis akan menggeser tanggal/angka keduanya.
//  4. Hak akses baru di fitur 'product-report': aksi `close` (Closing) dan `reopen` (Buka Ulang Closing)
//     diberikan ke role `admin`. Super Admin otomatis (bypass di rbac.ts). Role lain diatur lewat menu Hak Akses Role.
// Aman diulang (IF NOT EXISTS / merge jsonb). TIDAK menjalankan backfill — itu skrip terpisah:
// scripts/backfill-opening-closing.mjs.
// Usage: node scripts/add-closings.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1 });

await sql.begin(async tx => {
  await tx`
    create table if not exists closings (
      id text primary key,
      period_from text,                       -- yyyy-mm-dd (tanggal bayar paling awal yang ikut), null untuk saldo awal tanpa data
      period_to text not null,                -- yyyy-mm-dd (tanggal closing / batas atas yang dipilih, WIB)
      closed_at timestamptz not null default now(),
      closed_by text,
      total_qty numeric,                      -- null untuk closing saldo awal (closing manual di luar sistem)
      total_cogs numeric,
      total_revenue numeric,
      item_count integer not null default 0,
      note text,
      status text not null default 'aktif' check (status in ('aktif', 'dibuka_ulang')),
      reopened_at timestamptz,
      reopened_by text,
      reopen_reason text,
      is_opening_balance boolean not null default false,
      created_at timestamptz not null default now()
    )
  `;
  console.log('OK  tabel closings');
  await tx`create index if not exists idx_closings_status_closed_at on closings (status, closed_at desc)`;
  // Hanya boleh ada satu closing saldo awal.
  await tx`create unique index if not exists uq_closings_opening_balance on closings (is_opening_balance) where is_opening_balance`;

  for (const table of ['orders', 'order_payments', 'consignment_recaps']) {
    await tx.unsafe(`alter table ${table} add column if not exists closing_id text references closings(id) on delete restrict`);
    await tx.unsafe(`create index if not exists idx_${table}_closing_id on ${table} (closing_id) where closing_id is not null`);
    console.log(`OK  kolom ${table}.closing_id`);
  }

  await tx`alter table orders add column if not exists paid_at timestamptz`;
  await tx`alter table consignment_recaps add column if not exists paid_at timestamptz`;
  console.log('OK  kolom orders.paid_at & consignment_recaps.paid_at');

  // Hak akses: admin mendapat close + reopen di product-report (merge, tidak menimpa aksi lain).
  const roles = await tx`select role, permissions from role_permissions where role = 'admin' for update`;
  for (const r of roles) {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : (r.permissions ?? {});
    perms['product-report'] = { ...(perms['product-report'] ?? {}), close: true, reopen: true };
    await tx`update role_permissions set permissions = ${JSON.stringify(perms)}::jsonb, updated_at = now() where role = ${r.role}`;
    console.log(`OK  hak akses ${r.role}: product-report close + reopen`);
  }
});
await sql.end();
