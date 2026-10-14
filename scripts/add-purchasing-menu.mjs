#!/usr/bin/env node
// One-time: Purchase Order (PO) dan Goods Receipt (GR) = dua menu sendiri di modul Operasional, sejajar dengan
// Gudang & Bahan Baku (dulu sub-tab di Bahan Baku). Hak akses 'purchase-orders' & 'goods-receipts' disalin dari
// 'materials' untuk role yang sudah punya akses Bahan Baku ('approve' ikut ke GR dan dicabut dari 'materials').
// Membersihkan juga menu/hak 'purchasing' dari versi sebelumnya. Aman diulang.
// Usage: node scripts/add-purchasing-menu.mjs
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
  const [mat] = await tx`select module_id from menus where id = 'materials' for update`;
  if (!mat) throw new Error('menu materials tidak ada');
  await tx`delete from menus where id = 'purchasing'`;
  // Urutan root modul: Gudang, Bahan Baku, PO, GR, Laporan (susun ulang dari urutan sekarang).
  const roots = await tx`select id from menus where module_id = ${mat.module_id} and parent_id is null and id not in ('purchase-orders', 'goods-receipts') order by "order"`;
  const ids = roots.map(r => r.id);
  const at = ids.indexOf('materials') + 1;
  ids.splice(at, 0, 'purchase-orders', 'goods-receipts');
  const defs = { 'purchase-orders': ['Purchase Order (PO)', 'ClipboardList'], 'goods-receipts': ['Goods Receipt (GR)', 'PackageCheck'] };
  for (const [i, id] of ids.entries()) {
    const d = defs[id];
    if (d) {
      await tx`
        insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
        values (${id}, ${mat.module_id}, null, ${id}, ${d[0]}, ${d[1]}, ${i}, true, now(), now())
        on conflict (id) do update set parent_id = null, module_id = excluded.module_id, label = excluded.label, icon = excluded.icon, "order" = excluded."order", updated_at = now()
      `;
    } else {
      await tx`update menus set "order" = ${i}, updated_at = now() where id = ${id}`;
    }
  }
  console.log('OK  menu: Purchase Order (PO) & Goods Receipt (GR) sejajar Bahan Baku');

  const roles = await tx`select role, permissions from role_permissions for update`;
  for (const r of roles) {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
    const m = perms?.materials;
    const old = perms?.purchasing;
    if (!m?.view && !old?.view) continue;
    const src = old ?? m;
    perms['purchase-orders'] = Object.fromEntries(['view', 'create', 'edit', 'delete'].filter(a => src[a]).map(a => [a, true]));
    perms['goods-receipts'] = Object.fromEntries(['view', 'create', 'edit', 'delete', 'approve'].filter(a => src[a]).map(a => [a, true]));
    delete perms.purchasing;
    if (m) delete m.approve;
    await tx`update role_permissions set permissions = ${JSON.stringify(perms)}::jsonb, updated_at = now() where role = ${r.role}`;
    console.log(`OK  hak akses ${r.role}: PO ${JSON.stringify(perms['purchase-orders'])}, GR ${JSON.stringify(perms['goods-receipts'])}`);
  }
});
await sql.end();
