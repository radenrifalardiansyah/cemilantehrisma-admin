#!/usr/bin/env node
// One-time: perbaiki data yatim lalu tambahkan FK constraint untuk relasi yang sudah divalidasi
// lewat scripts/check-fk-orphans.mjs. Dijalankan sekali dalam satu transaksi lewat DIRECT_URL.
// Usage: node scripts/add-fk-constraints.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { CANDIDATES } from './fk-candidates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^"(.*)"$/, '$1');
  }
}

// menus.parent_id: SET NULL supaya hapus menu induk tidak diblokir (anak jadi top-level).
// Semua relasi lain: RESTRICT, konsisten dengan pola guard manual yang sudah ada di app
// (mis. kategori/wallet tidak boleh dihapus kalau masih direferensikan).
const ON_DELETE_OVERRIDE = {
  menus_parent_id_fkey: 'SET NULL',
};

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

  await sql.begin(async (tx) => {
    console.log('-- Perbaikan data yatim --');

    const priceHistoryFixed = await tx`
      update price_history
      set product_id = null
      where product_id is not null
        and not exists (select 1 from products p where p.id = price_history.product_id)
    `;
    console.log(`price_history.product_id -> NULL: ${priceHistoryFixed.count} baris`);

    const recapsFixed = await tx`
      update consignment_recaps
      set warehouse_id = null
      where warehouse_id = ''
    `;
    console.log(`consignment_recaps.warehouse_id ('' -> NULL): ${recapsFixed.count} baris`);

    const existing = await tx`
      select conname from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
    `;
    const existingNames = new Set(existing.map((r) => r.conname));

    console.log('\n-- Tambah FK constraint --');
    for (const c of CANDIDATES) {
      if (existingNames.has(c.name)) {
        console.log(`SKIP  ${c.table}.${c.column} -> ${c.refTable}.${c.refColumn}  (constraint sudah ada sebelumnya)`);
        continue;
      }
      const onDelete = ON_DELETE_OVERRIDE[c.name] ?? 'RESTRICT';
      const ddl = `
        alter table ${c.table}
        add constraint ${c.name}
        foreign key (${c.column}) references ${c.refTable} (${c.refColumn})
        on delete ${onDelete}
      `;
      await tx.unsafe(ddl);
      console.log(`OK    ${c.table}.${c.column} -> ${c.refTable}.${c.refColumn}  (ON DELETE ${onDelete})`);
    }
  });

  console.log('\nSelesai. Semua perubahan di-commit dalam satu transaksi.');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\nGAGAL — transaksi di-rollback otomatis, tidak ada perubahan yang tersimpan.');
  console.error(err.message);
  process.exit(1);
});
