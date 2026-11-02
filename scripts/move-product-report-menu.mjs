#!/usr/bin/env node
// One-time: pindahkan menu "Laporan Produk" (feature_key 'product-report') dari modul Keuangan > Laporan
// ke modul Manajemen > Laporan (folder yang sama dengan Laporan Harian Mitra). Hak akses tidak berubah. Aman diulang.
// Usage: node scripts/move-product-report-menu.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1 });

await sql.begin(async tx => {
  const [target] = await tx`select id, module_id from menus where id = 'mitra-report' for update`;
  if (!target) throw new Error('menu Laporan Harian Mitra tidak ada (jalankan add-mitra-report-menu.mjs dulu)');
  const [menu] = await tx`select id, module_id, parent_id from menus where feature_key = 'product-report' for update`;
  if (!menu) throw new Error("menu dengan feature_key 'product-report' tidak ada");

  const [{ parent_id }] = await tx`select parent_id from menus where id = 'mitra-report'`;
  const [{ next: order }] = await tx`select coalesce(max("order"), -1) + 1 as next from menus where parent_id = ${parent_id}`;
  await tx`update menus set module_id = ${target.module_id}, parent_id = ${parent_id}, "order" = ${order}, updated_at = now() where id = ${menu.id}`;
  console.log(`OK  menu Laporan Produk dipindah ke Manajemen > Laporan (order ${order})`);
});
await sql.end();
