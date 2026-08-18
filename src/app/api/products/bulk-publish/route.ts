import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidateStorefront } from '@/lib/revalidate';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { ids, published } = await req.json() as { ids: string[]; published: boolean };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db    = getDb();
  const batch = db.batch();
  for (const id of ids) {
    batch.update(db.collection('products').doc(id), { published, updatedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  after(() => revalidateStorefront('products'));
  return Response.json({ updated: ids.length });
}
