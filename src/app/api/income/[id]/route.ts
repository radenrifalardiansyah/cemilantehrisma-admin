import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'income', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const ref = db.collection('income').doc(id);
  const existing = await ref.get();
  const before = existing.data();
  const data = await req.json() as Record<string, unknown>;
  await ref.update({
    category: data.category ?? 'Lainnya',
    description: data.description ?? '',
    amount: Number(data.amount) || 0,
    items: Array.isArray(data.items) ? data.items : [],
    date: data.date,
    note: data.note ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    const updated = await ref.get();
    const after = updated.data();
    await logHistory(db, {
      entity: 'income',
      entityId: id,
      entityLabel: `${after?.description ?? after?.category ?? 'Pemasukan'} - Rp ${Number(after?.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'update',
      actor: guard,
      before,
      after,
    });
  } catch (err) {
    console.error('Failed to write history for income update', err);
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'income', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const ref = db.collection('income').doc(id);
  const existing = await ref.get();
  const before = existing.data();
  await ref.delete();
  try {
    await logHistory(db, {
      entity: 'income',
      entityId: id,
      entityLabel: `${before?.description ?? before?.category ?? 'Pemasukan'} - Rp ${Number(before?.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch (err) {
    console.error('Failed to write history for income delete', err);
  }
  return Response.json({ ok: true });
}
