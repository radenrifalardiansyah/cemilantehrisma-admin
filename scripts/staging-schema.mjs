#!/usr/bin/env node
// Salin SKEMA (tanpa data) dari produksi ke staging untuk uji konkurensi/deadlock.
//   node scripts/staging-schema.mjs dump   → baca skema produksi (read-only) ke file
//   node scripts/staging-schema.mjs load   → muat file itu ke staging
// Pengaman: produksi hanya dibaca (pg_dump --schema-only); semua tulis hanya ke project staging,
// dan skrip menolak jalan kalau URL staging bukan project staging yang diizinkan.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROD_REF = 'ylepyjyzxcchcvucvsyq';
const STAGING_REF = 'cisazsayvrxgnhzrnihm';
const PG_BIN = '/usr/local/opt/postgresql@17/bin';
const DUMP_FILE = process.env.SCHEMA_FILE || path.join(ROOT, '.staging-schema.sql');

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

function fail(msg) { console.error('GAGAL:', msg); process.exit(1); }

const mode = process.argv[2];
const prod = loadEnv('.env.local').DIRECT_URL;
const staging = loadEnv('.env.staging').DIRECT_URL;

if (!staging || staging.includes('GANTI_PASSWORD')) fail('DIRECT_URL di .env.staging belum diisi password.');
if (!staging.includes(STAGING_REF)) fail('DIRECT_URL di .env.staging bukan project staging yang diizinkan.');
if (staging.includes(PROD_REF)) fail('DIRECT_URL di .env.staging menunjuk ke PRODUKSI — dibatalkan.');

if (mode === 'dump') {
  if (!prod || !prod.includes(PROD_REF)) fail('DIRECT_URL produksi di .env.local tidak ditemukan/tidak cocok.');
  const r = spawnSync(`${PG_BIN}/pg_dump`, [
    '--schema-only', '--no-owner', '--no-privileges', '--no-comments', '-n', 'public',
    '-f', DUMP_FILE, prod,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) fail('pg_dump gagal.');
  console.log('OK: skema produksi (read-only) disimpan di', DUMP_FILE);
} else if (mode === 'load') {
  if (!existsSync(DUMP_FILE)) fail('File skema belum ada — jalankan "dump" dulu.');
  const count = spawnSync(`${PG_BIN}/psql`, [staging, '-Atc', "select count(*) from information_schema.tables where table_schema='public'"], { encoding: 'utf8' });
  if (count.status !== 0) fail('Tidak bisa terhubung ke staging: ' + (count.stderr || '').split('\n')[0]);
  if (Number(count.stdout.trim()) > 0 && !process.argv.includes('--force')) fail('Staging sudah berisi tabel di schema public — pakai --force kalau memang mau menimpa.');
  const r = spawnSync(`${PG_BIN}/psql`, [staging, '-v', 'ON_ERROR_STOP=0', '-q', '-f', DUMP_FILE], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) fail('psql gagal.');
  console.log('OK: skema dimuat ke staging.');
} else if (mode === 'check') {
  const q = "select (select count(*) from information_schema.tables where table_schema='public') as tabel, (select count(*) from public.products) as produk, (select count(*) from public.warehouses) as gudang";
  const r = spawnSync(`${PG_BIN}/psql`, [staging, '-c', q], { stdio: 'inherit' });
  if (r.status !== 0) fail('check gagal.');
} else {
  fail('Pakai: node scripts/staging-schema.mjs dump|load|check');
}
