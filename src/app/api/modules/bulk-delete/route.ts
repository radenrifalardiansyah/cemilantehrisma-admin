import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'modules', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();
  const menusSnap = await db.collection('menus').get();
  const modulesInUse = new Set(menusSnap.docs.map(d => d.data().moduleId as string));

  const deletable: string[] = [];
  let skippedInUse = 0;
  for (const id of ids) {
    if (modulesInUse.has(id)) { skippedInUse++; continue; }
    deletable.push(id);
  }

  const batch = db.batch();
  for (const id of deletable) batch.delete(db.collection('modules').doc(id));
  await batch.commit();

  return Response.json({ deleted: deletable.length, skippedInUse });
}
