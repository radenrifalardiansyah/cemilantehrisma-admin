import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { hasPermission, getRolePermissionsMap, checkPermission } from '@/lib/rbac';
import { FEATURE_KEY_SET } from '@/lib/permissions';
import { rowToModule, rowToMenu, type ModuleRow, type MenuRow } from '@/lib/nav-pg';

// Every logged-in session fetches this once on mount (sidebar build) — was two raw
// collection scans on every session, now collapsed across concurrent sessions for 20s.
// Tagged so mutations (create/edit/delete/reorder) can invalidate immediately instead
// of waiting out the TTL — Struktur Menu's reorder chevrons refetch right after saving
// and need the fresh order, not a stale one from up to 20s ago.
const getModulesAndMenus = unstable_cache(
  async () => {
    const sql = getSql();
    const [modRows, menuRows] = await Promise.all([
      sql<ModuleRow[]>`select * from modules order by "order" asc`,
      sql<MenuRow[]>`select * from menus order by "order" asc`,
    ]);
    return { modules: modRows.map(rowToModule), menus: menuRows.map(rowToMenu) };
  },
  ['modules-and-menus'],
  { revalidate: 20, tags: ['modules-and-menus'] },
);

// Two modes, selected by an explicit `?scope=manage` query param (not by the
// caller's own permissions — an Admin/Super Admin who can manage menus still
// needs the filtered/active-only view when THEY load their own sidebar, or
// they'd see inactive menu items in their live nav). Default (no query param):
// only active items the caller personally has `view` on for the underlying
// featureKey — this is what builds everyone's real sidebar, regardless of
// whether they can manage menus. `?scope=manage`: full unfiltered list
// (including inactive), gated by `menus:view`, for the Struktur Menu screen.
export async function GET(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();

  let { modules, menus } = await getModulesAndMenus();

  const wantsManage = new URL(req.url).searchParams.get('scope') === 'manage';
  if (wantsManage) {
    // Struktur Menu needs this to edit the tree; Hak Akses Role needs it
    // purely as read-only structural metadata (grouping/order/icons) to lay
    // out the permission matrix — neither leaks anything sensitive, so
    // either permission is enough.
    if (!(await hasPermission(user, ['menus', 'role-permissions'], 'view'))) {
      return Response.json({ error: 'Anda tidak memiliki akses untuk aksi ini.' }, { status: 403 });
    }
    return Response.json({ modules, menus });
  }

  menus = menus.filter(m => m.isActive);
  // One role_permissions read for the whole list instead of one per menu item (was a
  // sequential N+1 — the biggest contributor to sidebar load time right after login).
  if (user.role === 'super-admin') {
    // menus already unfiltered — super-admin sees everything.
  } else {
    const permissions = await getRolePermissionsMap(user.role);
    // Folder menus (featureKey null — pure grouping, no page of their own) have nothing
    // for checkPermission to check, so they can't be filtered the normal way: a folder is
    // visible only if at least one of its (possibly nested) children is visible.
    const childrenByParent = new Map<string, typeof menus>();
    for (const m of menus) {
      if (!m.parentId) continue;
      const siblings = childrenByParent.get(m.parentId) ?? [];
      siblings.push(m);
      childrenByParent.set(m.parentId, siblings);
    }
    const visibleCache = new Map<string, boolean>();
    const isVisible = (m: (typeof menus)[number]): boolean => {
      const cached = visibleCache.get(m.id);
      if (cached !== undefined) return cached;
      visibleCache.set(m.id, false); // cycle guard while this node is being resolved
      const result = m.featureKey
        ? checkPermission(permissions, m.featureKey, 'view')
        : (childrenByParent.get(m.id) ?? []).some(isVisible);
      visibleCache.set(m.id, result);
      return result;
    };
    menus = menus.filter(isVisible);
  }
  const usedModuleIds = new Set(menus.map(m => m.moduleId));
  modules = modules.filter(m => m.isActive && usedModuleIds.has(m.id));

  return Response.json({ modules, menus });
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'menus', 'create'))) {
    return Response.json({ error: 'Anda tidak memiliki akses untuk aksi ini.' }, { status: 403 });
  }

  const { moduleId, parentId, featureKey, label, icon, isActive } = await req.json() as {
    moduleId: string; parentId?: string | null; featureKey?: string | null; label: string; icon: string; isActive?: boolean;
  };

  if (!moduleId || !label || !icon) {
    return Response.json({ error: 'Modul, label, dan ikon wajib diisi.' }, { status: 400 });
  }
  // featureKey kosong/null = menu folder murni (cuma mengelompokkan children, tidak
  // terhubung ke screen apapun) — lihat AppShell.tsx untuk cara ia dirender di sidebar.
  const isFolder = !featureKey;
  if (!isFolder && !FEATURE_KEY_SET.has(featureKey)) {
    return Response.json({ error: `Screen "${featureKey}" tidak dikenal.` }, { status: 400 });
  }

  const sql = getSql();
  const active = isActive ?? true;
  if (active && !isFolder) {
    const [dupe] = await sql<{ label: string }[]>`select label from menus where feature_key = ${featureKey} and is_active = true limit 1`;
    if (dupe) {
      return Response.json(
        { error: `Screen "${featureKey}" sudah punya menu aktif ("${dupe.label}").` },
        { status: 409 },
      );
    }
  }

  // max(order)+1, bukan jumlah baris — count menyusut tiap ada menu yang dihapus, jadi menu
  // baru bisa dapat `order` yang bentrok dengan menu lain yang masih ada di modul ini.
  const [{ maxOrder }] = await sql<{ maxOrder: number | null }[]>`select max("order") as "maxOrder" from menus where module_id = ${moduleId}`;
  const nextOrder = (maxOrder ?? -1) + 1;
  const id = randomUUID();
  await sql`
    insert into menus (id, module_id, parent_id, feature_key, label, icon, "order", is_active, created_at, updated_at)
    values (${id}, ${moduleId}, ${parentId ?? null}, ${isFolder ? null : featureKey}, ${label}, ${icon}, ${nextOrder}, ${active}, now(), now())
  `;
  revalidateTag('modules-and-menus', { expire: 0 });
  return Response.json({ id });
}
