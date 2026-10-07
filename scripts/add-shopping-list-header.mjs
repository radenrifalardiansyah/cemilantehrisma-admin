#!/usr/bin/env node
// One-time: Daftar Belanja jadi dokumen per (tanggal + supplier). Tambah kolom
// `material_shopping_items.shopping_date` (yyyy-mm-dd), `supplier_id`, `supplier_name`.
// Data lama: tanggal = tanggal item dibuat (WIB); nama toko yang dulu ditulis di `note`
// dipindah ke `supplier_name` (dan dicocokkan ke supplier terdaftar kalau namanya sama).
// Usage: node scripts/add-shopping-list-header.mjs [--dry]   (--dry = uji lalu rollback)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

  try {
    await sql.begin(async tx => {
      await tx`alter table material_shopping_items add column if not exists shopping_date text`;
      await tx`alter table material_shopping_items add column if not exists supplier_id text`;
      await tx`alter table material_shopping_items add column if not exists supplier_name text`;

      // Backfill hanya baris yang belum punya shopping_date (aman dijalankan ulang).
      const filled = await tx`
        update material_shopping_items set
          shopping_date = to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD'),
          supplier_name = coalesce(nullif(trim(note), ''), ''),
          note = null
        where shopping_date is null
      `;
      const matched = await tx`
        update material_shopping_items i set supplier_id = s.id
        from suppliers s
        where i.supplier_id is null and i.supplier_name <> '' and lower(s.name) = lower(i.supplier_name)
      `;
      await tx`alter table material_shopping_items alter column shopping_date set not null`;
      await tx`alter table material_shopping_items alter column supplier_name set not null`;
      await tx`alter table material_shopping_items alter column supplier_name set default ''`;
      await tx`create index if not exists material_shopping_date_idx on material_shopping_items (shopping_date desc)`;
      console.log(`OK  kolom baru; backfill ${filled.count} baris, ${matched.count} cocok supplier terdaftar`);
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
