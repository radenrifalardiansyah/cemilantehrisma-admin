#!/usr/bin/env node
// One-time: pembayaran sebagian (cicilan) untuk REKAP MITRA (consignment_recaps).
//  Tabel `consignment_recap_payments`: satu baris = satu penerimaan uang untuk sebuah rekap belum lunas.
//   - recap_id   FK -> consignment_recaps(id) ON DELETE RESTRICT (aplikasi menghapus barisnya dulu saat rekap dihapus)
//   - paid_at    timestamptz = tanggal uang diterima (sama seperti order_payments.paid_at; dasar tanggal bayar di Closing)
//   - wallet_id  dompet tujuan (uang langsung masuk saldo dompet ini)
//   - voided     pembayaran dibatalkan (baris tetap ada sebagai jejak audit; tidak dihitung ke mana pun)
//   - closing_id FK -> closings(id) ON DELETE RESTRICT: terisi saat Closing HPP mencakup pembayaran ini (HPP proporsional per
//                pembayaran, sama seperti order_payments); dikosongkan saat closing dibuka ulang.
// Status rekap (belum_lunas / sebagian / lunas) DITURUNKAN di aplikasi dari total_revenue vs jumlah pembayaran aktif; kolom
// consignment_recaps.payment_status tetap 'belum_lunas' | 'lunas' (berubah ke 'lunas' saat sisa <= Rp 1, paid_at = tanggal
// pembayaran pelunas). Rekap yang punya baris pembayaran dihitung ke saldo dompet PER PEMBAYARAN (bukan total rekap).
// Aditif & idempoten (IF NOT EXISTS); TIDAK ada backfill: rekap lunas lama tidak diubah, rekap belum_lunas lama = 0 dibayar.
// Usage: node scripts/add-recap-payments.mjs
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
    create table if not exists consignment_recap_payments (
      id text primary key,
      recap_id text not null references consignment_recaps(id) on delete restrict,
      amount numeric not null check (amount > 0),
      paid_at timestamptz not null default now(),
      wallet_id text,
      note text not null default '',
      created_by text,
      created_at timestamptz not null default now(),
      voided boolean not null default false,
      voided_at timestamptz,
      closing_id text references closings(id) on delete restrict
    )
  `;
  await tx`alter table consignment_recap_payments enable row level security`;
  console.log('OK  tabel consignment_recap_payments (RLS aktif)');
  await tx`create index if not exists idx_crp_recap on consignment_recap_payments (recap_id)`;
  await tx`create index if not exists idx_crp_wallet on consignment_recap_payments (wallet_id) where not voided`;
  await tx`create index if not exists idx_crp_paid_at on consignment_recap_payments (paid_at) where not voided`;
  await tx`create index if not exists idx_crp_closing_id on consignment_recap_payments (closing_id) where closing_id is not null`;
  console.log('OK  index recap_id, wallet_id, paid_at, closing_id');
});
await sql.end();
