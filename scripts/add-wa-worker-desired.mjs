#!/usr/bin/env node
// One-time (Teruskan Stok WA): kolom `wa_forward_settings.worker_desired` — tombol Nyalakan/Matikan koneksi WhatsApp di admin.
// true = worker menyambung ke WhatsApp; false = worker tetap hidup (standby) tapi memutus koneksi.
// Plus tabel `wa_worker_events` (log kejadian worker untuk halaman admin). Aman diulang.
// Usage: node scripts/add-wa-worker-desired.mjs
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
await sql`alter table wa_forward_settings add column if not exists worker_desired boolean not null default true`;
console.log('OK  column wa_forward_settings.worker_desired');
// Log kejadian worker (terhubung/putus, pesan masuk & alasan diteruskan/dilewati, error) agar terlihat di admin.
await sql`
  create table if not exists wa_worker_events (
    id bigserial primary key,
    at timestamptz not null default now(),
    level text not null default 'info' check (level in ('info', 'warn', 'error')),
    text text not null
  )
`;
await sql`create index if not exists wa_worker_events_at_idx on wa_worker_events (at desc)`;
console.log('OK  table wa_worker_events');
await sql.end();
