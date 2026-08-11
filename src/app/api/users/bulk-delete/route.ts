import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission, assertCanDeleteUser } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'users', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const deletable = ids.filter(id => assertCanDeleteUser(guard, id).ok);
  const skippedSelf = ids.length - deletable.length;

  const db = getDb();
  const batch = db.batch();
  for (const id of deletable) batch.delete(db.collection('users').doc(id));
  await batch.commit();

  return Response.json({ deleted: deletable.length, skippedSelf });
}
