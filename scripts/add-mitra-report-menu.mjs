#!/usr/bin/env node
// One-time: menu "Laporan" (folder) di modul Manajemen dengan sub-menu "Laporan Harian Mitra" + hak akses 'mitra-report'.
// Role yang sudah punya akses Mitra (consignment.view) otomatis mendapat view. Tidak menyentuh menu lain. Aman diulang.
// Usage: node scripts/add-mitra-report-menu.mjs
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
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1 });

await sql.begin(async tx => {
  const [mitra] = await tx`select module_id from menus where id = 'consignment' for update`;
  if (!mitra) throw new Error('menu consignment (Mitra) tidak ada');
  const moduleId = mitra.module_id;

  // Folder "Laporan" di modul ini (dipakai ulang kalau sudah ada), diletakkan paling bawah.
  let [folder] = await tx`select id from menus where module_id = ${moduleId} and parent_id is null and feature_key is null and label = 'Laporan' limit 1`;
  if (!folder) {
    const [{ next }] = await tx`select coalesce(max("order"), -1) + 1 as next from menus where module_id = ${moduleId} and parent_id is null`;
    folder = { id: randomUUID() };
    await tx`
      insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
      values (${folder.id}, ${moduleId}, null, null, 'Laporan', 'ClipboardList', ${next}, true, now(), now())
    `;
    console.log('OK  menu: folder Laporan (Manajemen)');
  }

  await tx`
    insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
    values ('mitra-report', ${moduleId}, ${folder.id}, 'mitra-report', 'Laporan Harian Mitra', 'FileBarChart', 0, true, now(), now())
    on conflict (id) do update set parent_id = excluded.parent_id, module_id = excluded.module_id, label = excluded.label, icon = excluded.icon, updated_at = now()
  `;
  console.log('OK  menu: Laporan Harian Mitra');

  const roles = await tx`select role, permissions from role_permissions for update`;
  for (const r of roles) {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
    if (!perms?.consignment?.view) continue;
    perms['mitra-report'] = { view: true };
    await tx`update role_permissions set permissions = ${JSON.stringify(perms)}::jsonb, updated_at = now() where role = ${r.role}`;
    console.log(`OK  hak akses ${r.role}: mitra-report view`);
  }
});
await sql.end();
