import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

const REFERENCING_COLLECTIONS = ['income', 'expenses', 'capitalEntries', 'materialPurchases', 'orders', 'consignmentRecaps'];

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = db.collection('wallets').doc(id);
  const existing = await ref.get();
  const before = existing.data();

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof data.name === 'string' && data.name.trim()) patch.name = data.name.trim();
  if (['cash', 'bank', 'ewallet', 'other'].includes(data.type as string)) patch.type = data.type;
  if (typeof data.icon === 'string' && data.icon) patch.icon = data.icon;
  if (typeof data.color === 'string' && data.color) patch.color = data.color;
  if (data.initialBalance !== undefined) patch.initialBalance = Number(data.initialBalance) || 0;
  if (typeof data.isActive === 'boolean') patch.isActive = data.isActive;

  await ref.update(patch);
  try {
    const updated = await ref.get();
    const after = updated.data();
    await logHistory(db, {
      entity: 'wallets',
      entityId: id,
      entityLabel: (after?.name as string | undefined) ?? id,
      action: 'update',
      actor: guard,
      before,
      after,
    });
  } catch (err) {
    console.error('Failed to write history for wallets update', err);
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();

  const checks = await Promise.all(
    REFERENCING_COLLECTIONS.map(col => db.collection(col).where('walletId', '==', id).limit(1).get()),
  );
  if (checks.some(snap => !snap.empty)) {
    return Response.json({ error: 'Dompet ini masih punya riwayat transaksi — nonaktifkan saja, tidak bisa dihapus.' }, { status: 400 });
  }

  const ref = db.collection('wallets').doc(id);
  const existing = await ref.get();
  const before = existing.data();
  await ref.delete();
  try {
    await logHistory(db, {
      entity: 'wallets',
      entityId: id,
      entityLabel: (before?.name as string | undefined) ?? id,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch (err) {
    console.error('Failed to write history for wallets delete', err);
  }
  return Response.json({ ok: true });
}
