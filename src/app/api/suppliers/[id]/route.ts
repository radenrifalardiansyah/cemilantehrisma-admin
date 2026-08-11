import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'suppliers', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  await getDb().collection('suppliers').doc(id).update({
    name: data.name,
    phone: data.phone ?? '',
    address: data.address ?? '',
    note: data.note ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'suppliers', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  await getDb().collection('suppliers').doc(id).delete();
  return Response.json({ ok: true });
}
