#!/usr/bin/env node
// One-time: buat data Daftar Belanja (status "Selesai") dari pembelian bahan baku manual yang
// sudah ada, supaya riwayat belanja lama ikut tampil. Tanggal daftar = tanggal pembelian
// (kolom `date`; kalau kosong, tanggal dibuat WIB). Pembelian yang dibatalkan, yang berasal dari
// PO/GR, atau yang sudah punya daftar belanja dilewati — aman dijalankan ulang.
// Baris hasil impor ditandai created_by = 'import-pembelian' (bisa dihapus lewat SQL kalau perlu).
// Usage: node scripts/backfill-shopping-from-purchases.mjs [--dry]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^"(.*)"$/, '$1');
  }
}

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v) ?? [];

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });
  try {
    await sql.begin(async tx => {
      const purchases = await tx`
        select p.id, p.supplier_id, p.supplier_name, p.items, p.note, p.date, p.created_at
        from material_purchases p
        where p.voided = false and coalesce(p.source, 'manual') = 'manual'
          and not exists (select 1 from material_shopping_items s where s.purchase_id = p.id)
        order by p.created_at
      `;
      const mats = new Set((await tx`select id from raw_materials`).map(r => r.id));
      let purchasesDone = 0, itemsMade = 0, skippedItems = 0;
      for (const p of purchases) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '')
          ? p.date
          : (await tx`select to_char(${p.created_at}::timestamptz at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as d`)[0].d;
        let made = 0;
        for (const it of parse(p.items)) {
          const qty = Number(it.qty);
          if (!it.materialId || !mats.has(it.materialId) || !(qty > 0)) { skippedItems++; continue; }
          await tx`
            insert into material_shopping_items
              (id, material_id, qty, price, note, shopping_date, supplier_id, supplier_name, checked, status, purchase_id, created_by, created_at, done_at)
            values
              (${randomUUID()}, ${it.materialId}, ${qty}, ${it.price != null ? Number(it.price) : null}, ${p.note?.trim() || null},
               ${date}, ${p.supplier_id ?? null}, ${p.supplier_name ?? ''}, true, 'done', ${p.id}, 'import-pembelian', ${p.created_at}, ${p.created_at})
          `;
          made++;
        }
        if (made > 0) { purchasesDone++; itemsMade += made; }
      }
      console.log(`${DRY ? '[DRY] ' : ''}Pembelian manual dibaca: ${purchases.length} · diubah jadi daftar: ${purchasesDone} · item dibuat: ${itemsMade} · item dilewati: ${skippedItems}`);
      if (DRY) throw new Error('DRY-RUN: rollback');
    });
  } catch (err) {
    if (DRY && err.message === 'DRY-RUN: rollback') console.log('DRY-RUN selesai, tidak ada yang disimpan.');
    else { console.error('GAGAL:', err.message); await sql.end(); process.exit(1); }
  }
  await sql.end();
  process.exit(0);
}

main();
