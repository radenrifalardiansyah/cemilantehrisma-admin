import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const codeTrim = typeof data.code === 'string' ? data.code.trim() : '';
  if (codeTrim) {
    const dup = await db.collection('consignmentLocations').where('code', '==', codeTrim).limit(1).get();
    if (!dup.empty && dup.docs[0].id !== id) {
      return Response.json({ error: `Kode "${codeTrim}" sudah digunakan lokasi lain.` }, { status: 409 });
    }
  }
  const locationRef = db.collection('consignmentLocations').doc(id);
  const beforeSnap = await locationRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() ?? null : null;
  const payload = {
    name: data.name,
    code: codeTrim,
    contactName: data.contactName ?? '',
    contactPhone: data.contactPhone ?? '',
    address: data.address ?? '',
    note: data.note ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  };
  await locationRef.update(payload);
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentLocations',
      entityId: id,
      entityLabel: (typeof data.name === 'string' && data.name) || (before?.name as string | undefined) || id,
      action: 'update',
      actor: guard,
      before,
      after: { ...before, ...payload },
    });
  } catch {}
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const locationRef = db.collection('consignmentLocations').doc(id);
  const beforeSnap = await locationRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() ?? null : null;
  await locationRef.delete();
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentLocations',
      entityId: id,
      entityLabel: (before?.name as string | undefined) || id,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch {}
  return Response.json({ ok: true });
}
