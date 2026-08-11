import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'income', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  await getDb().collection('income').doc(id).update({
    category: data.category ?? 'Lainnya',
    description: data.description ?? '',
    amount: Number(data.amount) || 0,
    items: Array.isArray(data.items) ? data.items : [],
    date: data.date,
    note: data.note ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'income', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  await getDb().collection('income').doc(id).delete();
  return Response.json({ ok: true });
}
