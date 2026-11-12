#!/usr/bin/env node
// One-time: status dokumen Kirim Stok (Mitra > Kirim Stok): draft → approved | ditolak.
//  - Kolom `status` text not null default 'approved' + check ('draft','approved','ditolak'). Default sengaja
//    'approved' supaya baris lama & kode lama (yang tidak menulis status) tetap berstatus approved; kode baru
//    menulis status secara eksplisit (POST /api/consignment/send → 'draft').
//  - `approved_by`/`approved_at`, `rejected_by`/`rejected_at`/`reject_reason`, `created_by` (jejak pembuat).
//  - Backfill: approved_at = created_at untuk baris lama yang sudah approved (approved_by dibiarkan null).
//  - Index (status, created_at) untuk filter laporan/daftar.
//  - Hak akses baru: fitur 'consignment' aksi `approve` diberikan ke role `admin` (merge jsonb, tidak menimpa
//    aksi lain). Super Admin otomatis (bypass di rbac.ts). Role lain: aksi yang belum ada di matriks dianggap
//    TIDAK diizinkan (checkPermission butuh nilai === true) — atur lewat menu Hak Akses Role.
// Idempotent (IF NOT EXISTS / merge jsonb). Usage: node scripts/add-shipment-status.mjs
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
  await tx`alter table consignment_shipments add column if not exists status text not null default 'approved'`;
  // Constraint dibuat hanya bila belum ada (ADD CONSTRAINT tidak punya IF NOT EXISTS).
  const [existing] = await tx`select 1 as ok from pg_constraint where conname = 'consignment_shipments_status_check' and conrelid = 'consignment_shipments'::regclass`;
  if (!existing) {
    await tx`alter table consignment_shipments add constraint consignment_shipments_status_check check (status in ('draft', 'approved', 'ditolak'))`;
  }
  await tx`alter table consignment_shipments add column if not exists approved_by text`;
  await tx`alter table consignment_shipments add column if not exists approved_at timestamptz`;
  await tx`alter table consignment_shipments add column if not exists rejected_by text`;
  await tx`alter table consignment_shipments add column if not exists rejected_at timestamptz`;
  await tx`alter table consignment_shipments add column if not exists reject_reason text`;
  await tx`alter table consignment_shipments add column if not exists created_by text`;
  console.log('OK  kolom consignment_shipments.status / approved_* / rejected_* / reject_reason / created_by');

  await tx`create index if not exists consignment_shipments_status_created_at_idx on consignment_shipments (status, created_at desc)`;
  console.log('OK  index (status, created_at)');

  const backfilled = await tx`
    update consignment_shipments set approved_at = created_at
    where status = 'approved' and approved_at is null
    returning id
  `;
  console.log(`OK  backfill approved_at = created_at untuk ${backfilled.length} baris`);

  // Hak akses: admin mendapat approve di consignment (merge, tidak menimpa aksi lain).
  const roles = await tx`select role, permissions from role_permissions where role = 'admin' for update`;
  for (const r of roles) {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : (r.permissions ?? {});
    perms['consignment'] = { ...(perms['consignment'] ?? {}), approve: true };
    await tx`update role_permissions set permissions = ${JSON.stringify(perms)}::jsonb, updated_at = now() where role = ${r.role}`;
    console.log(`OK  hak akses ${r.role}: consignment approve`);
  }
});
await sql.end();
