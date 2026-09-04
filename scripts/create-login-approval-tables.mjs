#!/usr/bin/env node
// One-time: tabel `login_requests` (alur persetujuan login konkuren) + kolom
// `profiles.sessions_invalidated_reason` (pesan spesifik saat sesi di-revoke oleh
// kick admin / login baru disetujui, dipakai rbac.ts::sessionExpired).
// Usage: node scripts/create-login-approval-tables.mjs
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

  const [{ data_type: idType }] = await sql`
    select data_type from information_schema.columns
    where table_name = 'login_history' and column_name = 'id'
  `;
  console.log(`login_history.id type: ${idType} (mengikuti tipe ini untuk login_requests.id)`);

  await sql`
    create table if not exists login_requests (
      id ${sql.unsafe(idType === 'uuid' ? 'uuid' : 'text')} primary key,
      username text not null references profiles(username) on delete cascade,
      ip text not null,
      user_agent text not null,
      device_label text not null,
      status text not null default 'pending',
      reject_reason text,
      user_payload jsonb not null,
      created_at timestamptz not null default now(),
      responded_at timestamptz,
      responded_by text
    )
  `;
  console.log('OK  table login_requests');

  await sql`
    create index if not exists login_requests_username_status_idx
    on login_requests (username, status)
  `;
  console.log('OK  index login_requests_username_status_idx');

  await sql`alter table profiles add column if not exists sessions_invalidated_reason text`;
  console.log('OK  column profiles.sessions_invalidated_reason');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
