import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission, ROLE_PERMISSIONS_TAG } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'roles', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();
  const usersSnap = await db.collection('users').get();
  const rolesInUse = new Set(usersSnap.docs.map(d => d.data().role as string));

  const deletable: string[] = [];
  let skippedSystem = 0;
  let skippedInUse = 0;
  for (const id of ids) {
    if (id === 'super-admin' || id === 'admin') { skippedSystem++; continue; }
    if (rolesInUse.has(id)) { skippedInUse++; continue; }
    deletable.push(id);
  }

  const batch = db.batch();
  for (const id of deletable) {
    batch.delete(db.collection('roles').doc(id));
    batch.delete(db.collection('role_permissions').doc(id));
  }
  await batch.commit();
  if (deletable.length > 0) revalidateTag(ROLE_PERMISSIONS_TAG, { expire: 0 });

  return Response.json({ deleted: deletable.length, skippedSystem, skippedInUse });
}
