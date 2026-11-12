#!/usr/bin/env node
// One-time: angkat menu Supplier & Produksi dari sub-menu Bahan Baku jadi menu tingkat atas di modul
// Operasional (sejajar Gudang & Bahan Baku), diurutkan tepat setelah Bahan Baku. Hak akses tidak berubah. Aman diulang.
// Usage: node scripts/move-supplier-production-menu.mjs
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
  const [bb] = await tx`select id, module_id, "order" from menus where id = 'materials' for update`;
  if (!bb) throw new Error("menu 'materials' (Bahan Baku) tidak ada");
  const items = await tx`select id from menus where id in ('suppliers', 'production') and parent_id = 'materials' order by "order" for update`;
  if (!items.length) { console.log('SKIP  Supplier & Produksi sudah bukan sub-menu Bahan Baku'); return; }

  // Geser menu tingkat atas setelah Bahan Baku untuk memberi ruang.
  await tx`update menus set "order" = "order" + ${items.length}, updated_at = now()
           where module_id = ${bb.module_id} and parent_id is null and "order" > ${bb.order}`;
  let order = bb.order + 1;
  for (const it of items) {
    await tx`update menus set parent_id = null, module_id = ${bb.module_id}, "order" = ${order}, updated_at = now() where id = ${it.id}`;
    console.log(`OK  ${it.id} -> tingkat atas (order ${order})`);
    order++;
  }
});
await sql.end();
