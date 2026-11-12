#!/usr/bin/env node
// Backfill SEKALI: satu closing "saldo awal" (is_opening_balance = true) yang menandai semua data LUNAS
// sampai tanggal batas (default 2026-11-11, WIB) sebagai sudah closing — closing sebelum fitur ini dilakukan
// manual di luar sistem. Jalankan SETELAH scripts/add-closings.mjs.
//
// Yang ditandai (closing_id = id saldo awal), memakai definisi yang SAMA dengan lib/closing.ts:
//  - orders        : lunas, TANPA baris order_payments, status bukan 'baru'/'dibatalkan', bukan transaksi gratis,
//                    tanggal bayar efektif (coalesce(paid_at, created_at)) <= batas.
//  - order_payments: tiap penerimaan cicilan dengan paid_at <= batas (pesanan induknya bukan 'baru'/'dibatalkan'/gratis).
//                    Memakai tanggal BAYAR cicilan, bukan tanggal transaksi pesanan: cicilan yang uangnya baru masuk
//                    setelah batas bukan bagian closing manual lama, jadi tetap "belum closing".
//  - consignment_recaps: lunas, tanggal bayar efektif (coalesce(paid_at, created_at)) <= batas.
//
// KANDIDAT "DILUNASI BELAKANGAN" (tidak ditandai, ikut closing berikutnya): order/rekap lunas yang dibuat <= batas
// tetapi tanggal bayarnya tidak diketahui dan kemungkinan jatuh SETELAH batas (uangnya baru ditransfer setelah closing
// manual lama). Kolom paid_at baru ada sejak fitur ini, jadi untuk data lama dipakai heuristik:
//   lunas + paid_at kosong + created_at <= batas + updated_at > akhir hari batas (WIB)
//   (+ khusus order: tanpa baris order_payments — cicilan sudah punya paid_at sendiri dan dinilai per baris).
// KELEMAHAN: updated_at ikut berubah pada edit APA PUN (ganti catatan, retur, dsb.), jadi heuristik ini bisa menyisihkan
// terlalu banyak (lunas tepat waktu tetapi diedit belakangan). Itu sisi yang aman: yang disisihkan hanya jadi ikut closing
// berikutnya (HPP-nya tidak hilang), sedangkan salah menandainya akan membuat HPP yang uangnya baru masuk dianggap sudah
// closing. Daftar kandidat SELALU dicetak (dry-run maupun tulis) untuk ditinjau. --include-edited = tandai juga kandidat
// (bila user memutuskan semuanya memang sudah closing manual).
// Total HPP/omzet/qty closing saldo awal disimpan NULL (closing manual lama tidak dihitung ulang); item_count terisi.
//
// Idempoten: kalau closing saldo awal sudah ada (mis. dijalankan dua kali), skrip berhenti tanpa mengubah apa pun.
// Usage:
//   node scripts/backfill-opening-closing.mjs --dry-run            # hanya hitung & tampilkan, tidak menulis
//   node scripts/backfill-opening-closing.mjs                      # tulis (batas 2026-11-11)
//   node scripts/backfill-opening-closing.mjs --cutoff=2026-11-11
//   node scripts/backfill-opening-closing.mjs --include-edited     # tandai juga kandidat "dilunasi belakangan"
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}

const dryRun = process.argv.includes('--dry-run');
const includeEdited = process.argv.includes('--include-edited');
const cutoff = (process.argv.find(a => a.startsWith('--cutoff='))?.split('=')[1]) ?? '2026-11-11';
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) { console.error('GAGAL: --cutoff harus yyyy-mm-dd'); process.exit(1); }
// Eksklusif: awal hari berikutnya (WIB) dari tanggal batas.
const cutoffEnd = new Date(new Date(`${cutoff}T00:00:00+07:00`).getTime() + 86_400_000);

const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1 });

try {
  await sql.begin(async tx => {
    // Serialkan dengan closing/buka-ulang lain (kunci yang sama dengan lib/closing.ts).
    await tx`select pg_advisory_xact_lock(hashtext('closings'))`;

    const [existing] = await tx`select id, period_to, status from closings where is_opening_balance`;
    if (existing) {
      console.log(`LEWATI  closing saldo awal sudah ada (id ${existing.id}, sampai ${existing.period_to}, status ${existing.status}).`);
      return;
    }

    const orderBase = tx`
      o.payment_status = 'lunas' and o.closing_id is null and o.status not in ('baru', 'dibatalkan') and coalesce(o.is_free, false) = false
      and not exists (select 1 from order_payments p where p.order_id = o.id)
      and coalesce(o.paid_at, o.created_at) < ${cutoffEnd}
    `;
    const orderLate = tx`o.paid_at is null and o.created_at < ${cutoffEnd} and coalesce(o.updated_at, o.created_at) >= ${cutoffEnd}`;
    const recapBase = tx`
      r.payment_status = 'lunas' and r.closing_id is null and coalesce(r.paid_at, r.created_at) < ${cutoffEnd}
    `;
    const recapLate = tx`r.paid_at is null and r.created_at < ${cutoffEnd} and coalesce(r.updated_at, r.created_at) >= ${cutoffEnd}`;
    const orderWhere = includeEdited ? orderBase : tx`${orderBase} and not (${orderLate})`;
    const recapWhere = includeEdited ? recapBase : tx`${recapBase} and not (${recapLate})`;
    const payWhere = tx`
      p.closing_id is null and p.paid_at < ${cutoffEnd}
      and o.status not in ('baru', 'dibatalkan') and coalesce(o.is_free, false) = false
    `;

    const lateOrders = await tx`
      select o.invoice_no, o.id, o.created_at, o.updated_at, o.total from orders o where ${orderBase} and ${orderLate} order by o.created_at, o.id`;
    const lateRecaps = await tx`
      select r.id, r.location_name, r.created_at, r.updated_at from consignment_recaps r where ${recapBase} and ${recapLate} order by r.created_at, r.id`;

    const [o] = await tx`select count(*)::int as n, min(coalesce(o.paid_at, o.created_at)) as first from orders o where ${orderWhere}`;
    const [p] = await tx`select count(*)::int as n, min(p.paid_at) as first from order_payments p join orders o on o.id = p.order_id where ${payWhere}`;
    const [r] = await tx`select count(*)::int as n, min(coalesce(r.paid_at, r.created_at)) as first from consignment_recaps r where ${recapWhere}`;
    console.log(`Batas: ${cutoff} (WIB, inklusif)`);
    console.log(`  orders (lunas sekaligus)  : ${o.n}`);
    console.log(`  order_payments (cicilan)  : ${p.n}`);
    console.log(`  consignment_recaps (lunas): ${r.n}`);

    const wib = d => new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
    console.log(`\nKandidat "dilunasi belakangan" (lunas, dibuat <= batas, diubah setelah batas; tanggal bayar tak diketahui): ${lateOrders.length} order, ${lateRecaps.length} rekap`);
    console.log(includeEdited ? '  --include-edited AKTIF: kandidat IKUT ditandai sebagai saldo awal.' : '  TIDAK ditandai (akan ikut closing berikutnya). Tinjau daftar ini; pakai --include-edited bila memang sudah closing manual.');
    for (const c of lateOrders) console.log(`  order ${c.invoice_no ?? c.id}  dibuat ${wib(c.created_at)}  diubah ${wib(c.updated_at)}  total ${c.total}`);
    for (const c of lateRecaps) console.log(`  rekap ${c.id} (${c.location_name})  dibuat ${wib(c.created_at)}  diubah ${wib(c.updated_at)}`);
    console.log('');

    if (dryRun) { console.log('DRY-RUN: tidak ada yang ditulis.'); return; }

    const firsts = [o.first, p.first, r.first].filter(Boolean).map(d => new Date(d));
    const periodFrom = firsts.length
      ? new Date(Math.min(...firsts.map(d => d.getTime()))).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
      : null;
    const id = randomUUID();
    await tx`
      insert into closings (id, period_from, period_to, closed_at, closed_by, item_count, note, status, is_opening_balance)
      values (${id}, ${periodFrom}, ${cutoff}, now(), 'system-backfill', ${o.n + p.n + r.n},
              ${`Saldo awal: closing manual sebelum fitur Closing (sampai ${cutoff}).`}, 'aktif', true)
    `;
    const u1 = await tx`update orders o set closing_id = ${id} where ${orderWhere}`;
    const u2 = await tx`update order_payments p set closing_id = ${id} from orders o where o.id = p.order_id and ${payWhere}`;
    const u3 = await tx`update consignment_recaps r set closing_id = ${id} where ${recapWhere}`;
    console.log(`OK  closing saldo awal ${id}: orders ${u1.count}, order_payments ${u2.count}, consignment_recaps ${u3.count}`);
  });
} catch (err) {
  console.error('GAGAL:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
