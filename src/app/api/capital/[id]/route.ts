import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'capital', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = db.collection('capitalEntries').doc(id);
  const existing = await ref.get();
  const before = existing.data();
  await ref.update({
    type: data.type === 'prive' ? 'prive' : 'modal',
    amount: Number(data.amount) || 0,
    date: data.date,
    note: data.note ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    const updated = await ref.get();
    const after = updated.data();
    const typeLabel = after?.type === 'prive' ? 'Modal Keluar' : 'Modal Masuk';
    await logHistory(db, {
      entity: 'capital',
      entityId: id,
      entityLabel: `${typeLabel} Rp ${Number(after?.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'update',
      actor: guard,
      before,
      after,
    });
  } catch (err) {
    console.error('Failed to write history for capital update', err);
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'capital', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const ref = db.collection('capitalEntries').doc(id);
  const existing = await ref.get();
  const before = existing.data();
  await ref.delete();
  try {
    const typeLabel = before?.type === 'prive' ? 'Modal Keluar' : 'Modal Masuk';
    await logHistory(db, {
      entity: 'capital',
      entityId: id,
      entityLabel: `${typeLabel} Rp ${Number(before?.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch (err) {
    console.error('Failed to write history for capital delete', err);
  }
  return Response.json({ ok: true });
}
