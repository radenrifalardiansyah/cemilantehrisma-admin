import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { ids, published } = await req.json() as { ids: string[]; published: boolean };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db    = getDb();
  const batch = db.batch();
  for (const id of ids) {
    batch.update(db.collection('products').doc(id), { published, updatedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  return Response.json({ updated: ids.length });
}
