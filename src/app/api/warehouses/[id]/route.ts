import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const doc = await getDb().collection('warehouses').doc(id).get();
  if (!doc.exists) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ warehouse: { id: doc.id, ...doc.data() } });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();

  const beforeSnap = await db.collection('warehouses').doc(id).get();
  const before = beforeSnap.exists ? beforeSnap.data() ?? null : null;

  const after = {
    name: data.name,
    location: data.location ?? '',
    description: data.description ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection('warehouses').doc(id).update(after);

  try {
    await logHistory(db, {
      entity: 'warehouses',
      entityId: id,
      entityLabel: (data.name as string) ?? (before?.name as string) ?? id,
      action: 'update',
      actor: guard,
      before,
      after,
    });
  } catch {
    // audit log failure must never fail the business request
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();

  const beforeSnap = await db.collection('warehouses').doc(id).get();
  const before = beforeSnap.exists ? beforeSnap.data() ?? null : null;

  await db.collection('warehouses').doc(id).delete();

  try {
    await logHistory(db, {
      entity: 'warehouses',
      entityId: id,
      entityLabel: (before?.name as string) ?? id,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch {
    // audit log failure must never fail the business request
  }

  // Hapus semua warehouse_stock entries untuk gudang ini
  const stockSnap = await db.collection('warehouse_stock').where('warehouseId', '==', id).get();
  if (!stockSnap.empty) {
    const batch = db.batch();
    stockSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  return Response.json({ ok: true });
}
