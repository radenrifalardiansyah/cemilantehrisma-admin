#!/usr/bin/env node
// One-time: tambah kolom `profiles.full_name` (nama lengkap yang tampil di dokumen/PDF) dan
// `profiles.signature` (URL gambar tanda tangan pengguna). Keduanya nullable: akun lama tetap valid
// dan dokumen jatuh kembali ke username kalau nama belum diisi.
// Usage: node scripts/add-profile-name-signature.mjs
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

  await sql`alter table profiles add column if not exists full_name text`;
  await sql`alter table profiles add column if not exists signature text`;
  console.log('OK  columns profiles.full_name / profiles.signature');

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
