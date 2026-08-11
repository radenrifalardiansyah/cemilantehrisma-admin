import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { hasPermission } from '@/lib/rbac';
import { FEATURE_KEY_SET } from '@/lib/permissions';
import { FieldValue } from 'firebase-admin/firestore';

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

  const db = getDb();
  const [modSnap, menuSnap] = await Promise.all([
    db.collection('modules').orderBy('order', 'asc').get(),
    db.collection('menus').orderBy('order', 'asc').get(),
  ]);
  let modules = modSnap.docs.map(d => ({ id: d.id, ...d.data() })) as { id: string; isActive: boolean }[];
  let menus = menuSnap.docs.map(d => ({ id: d.id, ...d.data() })) as {
    id: string; moduleId: string; featureKey: string; isActive: boolean;
  }[];

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
  const visible: typeof menus = [];
  for (const m of menus) {
    if (await hasPermission(user, m.featureKey, 'view')) visible.push(m);
  }
  menus = visible;
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
    moduleId: string; parentId?: string | null; featureKey: string; label: string; icon: string; isActive?: boolean;
  };

  if (!moduleId || !featureKey || !label || !icon) {
    return Response.json({ error: 'Modul, screen, label, dan ikon wajib diisi.' }, { status: 400 });
  }
  if (!FEATURE_KEY_SET.has(featureKey)) {
    return Response.json({ error: `Screen "${featureKey}" tidak dikenal.` }, { status: 400 });
  }

  const db = getDb();
  const active = isActive ?? true;
  if (active) {
    const dupe = await db.collection('menus')
      .where('featureKey', '==', featureKey).where('isActive', '==', true).get();
    if (!dupe.empty) {
      return Response.json(
        { error: `Screen "${featureKey}" sudah punya menu aktif ("${dupe.docs[0].data().label}").` },
        { status: 409 },
      );
    }
  }

  const countSnap = await db.collection('menus').where('moduleId', '==', moduleId).get();
  const now = FieldValue.serverTimestamp();
  const ref = db.collection('menus').doc();
  await ref.set({
    moduleId, parentId: parentId ?? null, featureKey, label, icon,
    order: countSnap.size, isActive: active, createdAt: now, updatedAt: now,
  });
  return Response.json({ id: ref.id });
}
