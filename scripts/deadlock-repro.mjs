#!/usr/bin/env node
// Tahap 1 — reproduksi risiko deadlock urutan-kunci pada alur stok. HANYA jalan ke staging.
//   node --experimental-strip-types scripts/deadlock-repro.mjs   (ITER=30 default, mis. ITER=50 ...)
//
// Tiap skenario menjalankan DUA transaksi bersamaan yang mengunci baris dengan urutan seperti
// kode aplikasi (variasi "sekarang"), lalu variasi "urutan seragam" (calon perbaikan). Hasil yang
// diharapkan: "sekarang" menghasilkan error 40P01 (deadlock), "seragam" tidak. Antar-kunci diberi
// jeda pendek (pg_sleep) supaya jendela balapannya lebar — ini mereproduksi POLA urutan kunci pada
// tabel asli (products, warehouse_stock, consignment_stock), bukan memanggil endpoint aplikasi.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD_REF = 'ylepyjyzxcchcvucvsyq';
const STAGING_REF = 'cisazsayvrxgnhzrnihm';
const ITER = Number(process.env.ITER || 30);
const GAP = 0.05; // detik antar-kunci

function envFile(f) {
  const out = {};
  for (const l of readFileSync(path.join(ROOT, f), 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}
const url = envFile('.env.staging').DIRECT_URL;
if (!url || url.includes('GANTI_PASSWORD') || !url.includes(STAGING_REF) || url.includes(PROD_REF)) {
  console.error('GAGAL: .env.staging bukan project staging yang valid — dibatalkan.');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: ITER > 0 ? 8 : 2, onnotice: () => {} });
const P = ['dltest-p1', 'dltest-p2'];
const W = ['dltest-wA', 'dltest-wB'];
const L = 'dltest-loc';
const wsId = (w, p) => `${w}_${p}`;
const csId = (p) => `${L}_${p}`;

async function cleanup() {
  await sql`delete from consignment_stock where id like 'dltest-%'`;
  await sql`delete from warehouse_stock where id like 'dltest-%'`;
  await sql`delete from consignment_locations where id like 'dltest-%'`;
  await sql`delete from warehouses where id like 'dltest-%'`;
  await sql`delete from products where id like 'dltest-%'`;
}
async function seed() {
  await cleanup();
  for (const p of P) await sql`insert into products (id, name, stock_qty) values (${p}, ${'Uji ' + p}, 1000)`;
  for (const w of W) await sql`insert into warehouses (id, name) values (${w}, ${'Gudang ' + w})`;
  await sql`insert into consignment_locations (id, name) values (${L}, 'Lokasi uji')`;
  for (const w of W) for (const p of P) await sql`insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty) values (${wsId(w, p)}, ${w}, ${p}, ${p}, 500)`;
  for (const p of P) await sql`insert into consignment_stock (id, location_id, product_id, product_name, stock_qty) values (${csId(p)}, ${L}, ${p}, ${p}, 100)`;
}

const lockProduct = (tx, p) => tx`select id from products where id = ${p} for update`;
const lockWs = (tx, w, p) => tx`select id from warehouse_stock where id = ${wsId(w, p)} for update`;
const lockCs = (tx, p) => tx`select id from consignment_stock where id = ${csId(p)} for update`;
const gap = (tx) => tx`select pg_sleep(${GAP})`;

// Tiap fungsi = badan satu transaksi; mengembalikan 'ok' | 'deadlock' | pesan error lain.
async function run(fn) {
  try { await sql.begin(fn); return 'ok'; }
  catch (e) { return e.code === '40P01' ? 'deadlock' : `error: ${e.message}`; }
}

// Sama, tapi dibungkus withDeadlockRetry ASLI dari src/lib/db-retry.ts (jaring pengaman di aplikasi).
// `retried` menghitung berapa kali deadlock tertangkap lalu diulang.
let retried = 0;
async function runWithRetry(fn) {
  const { withDeadlockRetry } = await import('../src/lib/db-retry.ts');
  try {
    await withDeadlockRetry(async () => {
      try { await sql.begin(fn); }
      catch (e) { if (e.code === '40P01') retried++; throw e; }
    });
    return 'ok';
  } catch (e) { return e.code === '40P01' ? 'deadlock' : `error: ${e.message}`; }
}

const SCENARIOS = [
  {
    name: 'A. Jual vs Kosongkan stok gudang',
    current: [
      async t => { await lockProduct(t, P[0]); await gap(t); await lockWs(t, W[0], P[0]); },   // jual: produk → gudang
      async t => { await lockWs(t, W[0], P[0]); await gap(t); await lockProduct(t, P[0]); },   // kosongkan: gudang → produk
    ],
    fixed: [
      async t => { await lockProduct(t, P[0]); await gap(t); await lockWs(t, W[0], P[0]); },
      async t => { await lockProduct(t, P[0]); await gap(t); await lockWs(t, W[0], P[0]); },   // kosongkan: produk dulu
    ],
  },
  {
    name: 'B. Transfer A→B vs B→A (produk sama)',
    current: [
      async t => { await lockWs(t, W[0], P[0]); await gap(t); await lockWs(t, W[1], P[0]); },  // A→B: asal dulu
      async t => { await lockWs(t, W[1], P[0]); await gap(t); await lockWs(t, W[0], P[0]); },  // B→A: asal dulu
    ],
    fixed: [
      async t => { await lockWs(t, W[0], P[0]); await gap(t); await lockWs(t, W[1], P[0]); },  // keduanya urut id
      async t => { await lockWs(t, W[0], P[0]); await gap(t); await lockWs(t, W[1], P[0]); },
    ],
  },
  {
    name: 'C. Kirim vs Rekap konsinyasi',
    current: [
      async t => { await lockProduct(t, P[0]); await gap(t); await lockCs(t, P[0]); },  // kirim: produk → stok titip
      async t => { await lockCs(t, P[0]); await gap(t); await lockProduct(t, P[0]); },  // rekap: stok titip → produk
    ],
    fixed: [
      async t => { await lockProduct(t, P[0]); await gap(t); await lockCs(t, P[0]); },
      async t => { await lockProduct(t, P[0]); await gap(t); await lockCs(t, P[0]); },    // rekap: produk dulu
    ],
  },
];

async function main() {
  console.log(`Staging OK. ITER=${ITER}. Menyiapkan data uji (awalan dltest-)…`);
  await seed();
  const rows = [];
  try {
    for (const sc of SCENARIOS) {
      for (const variant of ['current', 'current+retry', 'fixed']) {
        const tally = { ok: 0, deadlock: 0, other: 0 };
        retried = 0;
        const others = new Set();
        for (let i = 0; i < ITER; i++) {
          const bodies = variant === 'fixed' ? sc.fixed : sc.current;
          const exec = variant === 'current+retry' ? runWithRetry : run;
          const res = await Promise.all(bodies.map(f => exec(f)));
          for (const r of res) {
            if (r === 'ok') tally.ok++;
            else if (r === 'deadlock') tally.deadlock++;
            else { tally.other++; others.add(r); }
          }
        }
        rows.push({ skenario: sc.name, variasi: variant === 'current' ? 'urutan LAMA' : variant === 'current+retry' ? 'urutan LAMA + retry' : 'urutan SERAGAM', transaksi: ITER * 2, ok: tally.ok, deadlock: tally.deadlock, diulang: retried, lain: tally.other });
        if (others.size) console.log('  error lain:', [...others].join(' | '));
      }
    }
  } finally {
    await cleanup();
    await sql.end();
  }
  console.table(rows);
  console.log('Data uji dihapus.');
}
main().catch(e => { console.error('GAGAL:', e.message); process.exit(1); });
