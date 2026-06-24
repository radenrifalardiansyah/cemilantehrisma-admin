import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';

type Ctx = { params: Promise<{ id: string; productId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id: warehouseId, productId } = await ctx.params;

  const snap = await getDb()
    .collection('stock')
    .where('warehouseId', '==', warehouseId)
    .where('productId', '==', productId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ entries });
}
