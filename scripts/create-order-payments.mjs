#!/usr/bin/env node
// One-time: tabel `order_payments` — pembayaran bertahap (cicilan) untuk pesanan kredit. Tiap baris
// = satu penerimaan uang ke satu dompet. Pesanan yang punya baris di sini dihitung ke saldo dompet
// dari baris ini (bukan dari total pesanan). Pesanan lama tanpa baris tidak berubah perilakunya.
// Usage: node scripts/create-order-payments.mjs
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
    create table if not exists order_payments (
      id text primary key,
      order_id text not null references orders(id),
      wallet_id text,
      amount numeric not null check (amount > 0),
      paid_at timestamptz not null default now(),
      note text,
      created_by text,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists order_payments_order_idx on order_payments (order_id)`;
  await sql`create index if not exists order_payments_wallet_idx on order_payments (wallet_id)`;
  console.log('OK  table order_payments');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
