import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'capital', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db    = getDb();
  const batch = db.batch();
  for (const id of ids) batch.delete(db.collection('capitalEntries').doc(id));
  await batch.commit();
  revalidateTag('admin-capital', { expire: 0 });
  return Response.json({ deleted: ids.length });
}
