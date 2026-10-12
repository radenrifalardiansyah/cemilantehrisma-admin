#!/usr/bin/env node
// One-time (Titip Jual): rincian pembayaran rekap ke penitip — tanggal, metode, rekening asal, no. referensi, catatan.
// Dipakai di nota PDF (bukti pembayaran) dan pesan WhatsApp. Aman diulang.
// Usage: node scripts/add-settlement-payment-info.mjs
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
await sql`alter table consign_settlements add column if not exists pay_date text`;
await sql`alter table consign_settlements add column if not exists pay_method text`;
await sql`alter table consign_settlements add column if not exists pay_from text not null default ''`;
await sql`alter table consign_settlements add column if not exists pay_reference text not null default ''`;
await sql`alter table consign_settlements add column if not exists pay_note text not null default ''`;
console.log('OK  consign_settlements.pay_date/pay_method/pay_from/pay_reference/pay_note');
await sql.end();
