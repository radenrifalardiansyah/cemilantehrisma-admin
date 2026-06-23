import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ productId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { productId } = await ctx.params;
  const snap = await getDb()
    .collection('stock')
    .where('productId', '==', productId)
    .orderBy('date', 'desc')
    .get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ entries });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { productId } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('stock').add({
    productId,
    ...data,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Update running stock on product document
  const qty = typeof data.qty === 'number' ? data.qty : 0;
  const type = data.type as 'in' | 'out';
  const delta = type === 'in' ? qty : -qty;
  await db.collection('products').doc(productId).update({
    stockQty: FieldValue.increment(delta),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return Response.json({ id: ref.id });
}
