import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { referencedMaterialIds } from '@/lib/materials';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();
  const referenced = await referencedMaterialIds(db);
  const deletable = ids.filter(id => !referenced.has(id));
  const skippedInUse = ids.length - deletable.length;

  const batch = db.batch();
  for (const id of deletable) batch.delete(db.collection('rawMaterials').doc(id));
  await batch.commit();
  if (deletable.length > 0) revalidateTag('admin-materials', { expire: 0 });
  return Response.json({ deleted: deletable.length, skippedInUse });
}
