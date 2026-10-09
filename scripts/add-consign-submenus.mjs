#!/usr/bin/env node
// One-time: Titip Jual jadi folder menu dengan 3 sub-menu (Data Titip Jual, Opname Titipan,
// Jurnal Kas Lapak). Menambah hak akses consign-opname & consign-journal untuk role yang sudah
// punya akses Titip Jual (aksi disamakan). Aman diulang.
// Usage: node scripts/add-consign-submenus.mjs
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
  const [main] = await tx`select id, module_id, "order" from menus where id = 'consign' for update`;
  if (!main) throw new Error('menu consign tidak ada');
  await tx`
    insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
    values ('consign-folder', ${main.module_id}, null, null, 'Titip Jual', 'Handshake', ${main.order}, true, now(), now())
    on conflict (id) do nothing
  `;
  await tx`update menus set parent_id = 'consign-folder', label = 'Data Titip Jual', icon = 'Store', "order" = 0, updated_at = now() where id = 'consign'`;
  for (const [id, label, icon, order] of [['consign-opname', 'Opname Titipan', 'ClipboardList', 1], ['consign-journal', 'Jurnal Kas Lapak', 'Wallet', 2]]) {
    await tx`
      insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
      values (${id}, ${main.module_id}, 'consign-folder', ${id}, ${label}, ${icon}, ${order}, true, now(), now())
      on conflict (id) do nothing
    `;
  }
  console.log('OK  menu: folder Titip Jual + 3 sub-menu');

  const roles = await tx`select role, permissions from role_permissions for update`;
  for (const r of roles) {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
    const c = perms?.consign;
    if (!c?.view) continue;
    perms['consign-opname'] = { view: true, ...(c.create ? { create: true } : {}), ...(c.delete ? { delete: true } : {}) };
    perms['consign-journal'] = { view: true, ...(c.edit ? { edit: true } : {}) };
    await tx`update role_permissions set permissions = ${JSON.stringify(perms)}::jsonb, updated_at = now() where role = ${r.role}`;
    console.log(`OK  hak akses ${r.role}: opname ${JSON.stringify(perms['consign-opname'])}, jurnal ${JSON.stringify(perms['consign-journal'])}`);
  }
});
await sql.end();
