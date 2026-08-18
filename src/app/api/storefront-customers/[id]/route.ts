import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'storefront-customers', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  await getDb().collection('storefront_customers').doc(id).delete();
  return Response.json({ ok: true });
}
