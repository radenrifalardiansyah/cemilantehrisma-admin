import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { orders } = await req.json() as { orders: { id: string; order: number }[] };
  if (!Array.isArray(orders) || orders.length === 0)
    return Response.json({ error: 'orders required' }, { status: 400 });

  const db    = getDb();
  const batch = db.batch();
  for (const { id, order } of orders) {
    batch.update(db.collection('products').doc(id), {
      order,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return Response.json({ ok: true });
}
