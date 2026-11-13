#!/usr/bin/env node
// One-time: fitur "Hutang Supplier" (pembelian bahan baku belum lunas + cicilan + jatuh tempo).
//  1. Tabel `material_purchase_payments`: satu baris = satu pembayaran/cicilan sebuah pembelian.
//      - purchase_id FK -> material_purchases(id) ON DELETE RESTRICT (aplikasi menghapus barisnya dulu saat pembelian dihapus)
//      - expense_id  = baris `expenses` pasangan pembayaran ini (category 'Bahan Baku', source_type 'material-purchase')
//      - voided      = pembayaran dibatalkan (pengeluaran pasangannya dihapus; baris tetap ada sebagai jejak audit)
//  2. Kolom `due_date` (text yyyy-mm-dd, opsional) pada `material_purchases` dan `goods_receipts`.
// Status pembelian (belum_lunas / sebagian / lunas) DITURUNKAN di aplikasi dari total vs jumlah pembayaran aktif;
// kolom material_purchases.payment_status tetap 'belum_lunas' | 'lunas' (berubah ke 'lunas' saat sisa <= Rp 1).
// Aditif & idempoten (IF NOT EXISTS); tidak ada backfill: pembelian lunas lama tidak diubah, belum_lunas lama = 0 dibayar.
// Usage: node scripts/add-purchase-payments.mjs
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
    create table if not exists material_purchase_payments (
      id text primary key,
      purchase_id text not null references material_purchases(id) on delete restrict,
      amount numeric not null check (amount > 0),
      date text not null,
      wallet_id text,
      expense_id text,
      note text not null default '',
      created_by text,
      created_at timestamptz not null default now(),
      voided boolean not null default false,
      voided_at timestamptz
    )
  `;
  await tx`alter table material_purchase_payments enable row level security`;
  console.log('OK  tabel material_purchase_payments (RLS aktif)');
  await tx`create index if not exists idx_mpp_purchase on material_purchase_payments (purchase_id)`;
  console.log('OK  index purchase_id');
  await tx`alter table material_purchases add column if not exists due_date text`;
  await tx`alter table goods_receipts add column if not exists due_date text`;
  console.log('OK  kolom due_date pada material_purchases & goods_receipts');
  await tx`create index if not exists idx_material_purchases_unpaid on material_purchases (due_date) where payment_status = 'belum_lunas' and not voided`;
  console.log('OK  index pembelian belum lunas');
});
await sql.end();
