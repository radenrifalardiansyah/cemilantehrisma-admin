import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const doc = await getDb().collection('warehouses').doc(id).get();
  if (!doc.exists) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ warehouse: { id: doc.id, ...doc.data() } });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  await getDb().collection('warehouses').doc(id).update({
    name: data.name,
    location: data.location ?? '',
    description: data.description ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const db = getDb();

  await db.collection('warehouses').doc(id).delete();

  // Hapus semua warehouse_stock entries untuk gudang ini
  const stockSnap = await db.collection('warehouse_stock').where('warehouseId', '==', id).get();
  if (!stockSnap.empty) {
    const batch = db.batch();
    stockSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  return Response.json({ ok: true });
}
