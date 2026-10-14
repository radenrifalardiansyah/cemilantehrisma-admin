#!/usr/bin/env node
// One-time (Teruskan Stok WA): tabel untuk worker WhatsApp yang membaca grup mitra lalu meneruskan update stok ke grup kita.
//   wa_groups           — daftar grup WA yang terdeteksi worker (id grup + nama)
//   wa_group_links      — pemetaan grup → mitra (consignment_locations); mitra tanpa grup tidak punya baris
//   wa_forward_settings — satu baris pengaturan: saklar, grup tujuan, kata kunci, batas kirim, status worker
//   wa_forward_log      — pesan yang lolos filter + status kirim (message_key unik = anti-dobel)
// Tidak mengubah tabel lain. Aman diulang.
// Usage: node scripts/add-wa-forward.mjs
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

await sql`
  create table if not exists wa_groups (
    jid text primary key,
    subject text not null default '',
    last_seen_at timestamptz not null default now()
  )
`;
await sql`
  create table if not exists wa_group_links (
    jid text primary key references wa_groups(jid) on delete cascade,
    location_id text not null references consignment_locations(id) on delete cascade,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  )
`;
await sql`create unique index if not exists wa_group_links_location_idx on wa_group_links (location_id)`;
await sql`
  create table if not exists wa_forward_settings (
    id int primary key default 1 check (id = 1),
    enabled boolean not null default false,
    target_jid text,
    keywords text[] not null default array['stok','stock','sisa','update','mie kremes']::text[],
    exclude_keywords text[] not null default '{}'::text[],
    max_per_hour int not null default 60 check (max_per_hour between 1 and 600),
    resync_requested boolean not null default false,
    worker_state text not null default 'offline',
    worker_last_seen timestamptz,
    updated_by text,
    updated_at timestamptz not null default now()
  )
`;
await sql`insert into wa_forward_settings (id) values (1) on conflict (id) do nothing`;
await sql`
  create table if not exists wa_forward_log (
    id text primary key,
    message_key text not null unique,
    source_jid text not null,
    location_id text,
    location_name text not null default '',
    sender_name text not null default '',
    body text not null default '',
    status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
    error text,
    received_at timestamptz not null default now(),
    sent_at timestamptz
  )
`;
await sql`create index if not exists wa_forward_log_received_idx on wa_forward_log (received_at desc)`;
console.log('OK  wa_groups, wa_group_links, wa_forward_settings, wa_forward_log');
await sql.end();
