#!/usr/bin/env node
// One-time: kolom autentikasi 2 langkah (TOTP) di `profiles`. Semua opsional/default aman:
// akun yang tidak mengaktifkan 2FA tidak berubah perilakunya.
//   totp_secret       — rahasia TOTP terenkripsi (AES-GCM), terisi sejak setup (belum aktif)
//   totp_enabled      — true setelah kode pertama diverifikasi
//   totp_recovery     — jsonb array hash SHA-256 kode pemulihan (sekali pakai)
//   totp_last_step    — langkah waktu TOTP terakhir yang dipakai (cegah kode dipakai ulang)
//   totp_fail_count / totp_locked_until — pembatas percobaan kode salah (tahan lintas instance)
// Usage: node scripts/add-profile-2fa.mjs
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

  await sql`alter table profiles add column if not exists totp_secret text`;
  await sql`alter table profiles add column if not exists totp_enabled boolean not null default false`;
  await sql`alter table profiles add column if not exists totp_recovery jsonb`;
  await sql`alter table profiles add column if not exists totp_last_step bigint`;
  await sql`alter table profiles add column if not exists totp_fail_count integer not null default 0`;
  await sql`alter table profiles add column if not exists totp_locked_until timestamptz`;
  console.log('OK  profiles.totp_*');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
