#!/usr/bin/env node
// One-time: menu "PO & GR" (feature_key 'purchasing') sejajar dengan Gudang & Bahan Baku di modul Operasional
// (dulu sub-tab di Bahan Baku). Hak akses 'purchasing' disalin dari 'materials' (termasuk approve) untuk role
// yang sudah punya akses Bahan Baku; 'approve' dicabut dari 'materials' karena kini milik 'purchasing'. Aman diulang.
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
  const [mat] = await tx`select module_id, "order" from menus where id = 'materials' for update`;
  if (!mat) throw new Error('menu materials tidak ada');
  const [exists] = await tx`select 1 as x from menus where id = 'purchasing'`;
  if (!exists) {
    // Sisipkan tepat setelah Bahan Baku: geser menu root lain di modul yang sama dengan order lebih besar.
    await tx`update menus set "order" = "order" + 1, updated_at = now() where module_id = ${mat.module_id} and parent_id is null and "order" > ${mat.order}`;
  }
  await tx`
    insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
    values ('purchasing', ${mat.module_id}, null, 'purchasing', 'PO & GR', 'ClipboardList', ${mat.order + 1}, true, now(), now())
    on conflict (id) do update set parent_id = null, module_id = excluded.module_id, label = excluded.label, icon = excluded.icon, updated_at = now()
  `;
  console.log('OK  menu: PO & GR (sejajar Bahan Baku)');

  const roles = await tx`select role, permissions from role_permissions for update`;
  for (const r of roles) {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
    const m = perms?.materials;
    if (!m?.view) continue;
    perms.purchasing = Object.fromEntries(['view', 'create', 'edit', 'delete', 'approve'].filter(a => m[a]).map(a => [a, true]));
    delete m.approve;
    await tx`update role_permissions set permissions = ${JSON.stringify(perms)}::jsonb, updated_at = now() where role = ${r.role}`;
    console.log(`OK  hak akses ${r.role}: ${JSON.stringify(perms.purchasing)}`);
  }
});
await sql.end();
