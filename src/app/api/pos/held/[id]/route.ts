import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await requirePermission(req, 'pos', 'delete');
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  await getDb().collection('posHeldTransactions').doc(id).delete();
  return Response.json({ ok: true });
}
