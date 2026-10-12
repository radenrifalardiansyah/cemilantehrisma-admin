#!/usr/bin/env node
// One-time: sub-menu "Produk Toko di Lapak" di bawah Titip Jual + hak akses 'stall-own' untuk role yang
// sudah punya akses Titip Jual (aksi disamakan). Aman diulang.
// Usage: node scripts/add-stall-own-menu.mjs
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
  const [main] = await tx`select module_id from menus where id = 'consign' for update`;
  if (!main) throw new Error('menu consign tidak ada');
  await tx`
    insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
    values ('stall-own', ${main.module_id}, 'consign', 'stall-own', 'Produk Toko di Lapak', 'Store', 2, true, now(), now())
    on conflict (id) do update set parent_id = 'consign', label = excluded.label, icon = excluded.icon, "order" = 2, updated_at = now()
  `;
  console.log('OK  menu: Produk Toko di Lapak (sub-menu Titip Jual)');
  const roles = await tx`select role, permissions from role_permissions for update`;
  for (const r of roles) {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
    const c = perms?.consign;
    if (!c?.view) continue;
    perms['stall-own'] = Object.fromEntries(['view', 'create', 'edit', 'delete'].filter(a => c[a]).map(a => [a, true]));
    await tx`update role_permissions set permissions = ${JSON.stringify(perms)}::jsonb, updated_at = now() where role = ${r.role}`;
    console.log(`OK  hak akses ${r.role}: ${JSON.stringify(perms['stall-own'])}`);
  }
});
await sql.end();
