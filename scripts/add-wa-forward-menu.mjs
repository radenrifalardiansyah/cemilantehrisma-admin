#!/usr/bin/env node
// One-time (Teruskan Stok WA): sub-menu "Teruskan Stok WA" di bawah menu Mitra + hak akses 'wa-forward'. Role yang punya
// akses Mitra (consignment) mendapat view (dan edit bila Mitra-nya bisa edit). Tidak menyentuh Titip Jual. Aman diulang.
// Usage: node scripts/add-wa-forward-menu.mjs
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
  const [mitra] = await tx`select id, module_id from menus where id = 'consignment' for update`;
  if (!mitra) throw new Error('menu consignment (Mitra) tidak ada');
  await tx`
    insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
    values ('wa-forward', ${mitra.module_id}, 'consignment', 'wa-forward', 'Teruskan Stok WA', 'MessageCircle', 0, true, now(), now())
    on conflict (id) do update set parent_id = 'consignment', module_id = excluded.module_id, label = excluded.label, icon = excluded.icon, updated_at = now()
  `;
  console.log('OK  menu: Teruskan Stok WA (sub-menu Mitra)');

  const roles = await tx`select role, permissions from role_permissions for update`;
  for (const r of roles) {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
    const c = perms?.consignment;
    if (!c?.view) continue;
    perms['wa-forward'] = { view: true, ...(c.edit ? { edit: true } : {}) };
    await tx`update role_permissions set permissions = ${JSON.stringify(perms)}::jsonb, updated_at = now() where role = ${r.role}`;
    console.log(`OK  hak akses ${r.role}: ${JSON.stringify(perms['wa-forward'])}`);
  }
});
await sql.end();
