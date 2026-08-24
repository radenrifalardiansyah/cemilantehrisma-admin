import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { referencedMaterialIds } from '@/lib/materials';

type Ctx = { params: Promise<{ id: string }> };

// Cuma nama & satuan yang bisa diedit di sini — stockQty & avgCost hanya
// berubah lewat /api/material-purchases (masuk) & /api/production (keluar).
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  await getDb().collection('rawMaterials').doc(id).update({
    name: data.name,
    unit: data.unit ?? '',
    minStock: Number(data.minStock) || 0,
    updatedAt: FieldValue.serverTimestamp(),
  });
  revalidateTag('admin-materials', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();

  const referenced = await referencedMaterialIds(db);
  if (referenced.has(id)) {
    return Response.json(
      { error: 'Bahan baku ini masih dipakai di riwayat pembelian atau produksi — tidak bisa dihapus.' },
      { status: 400 },
    );
  }

  await db.collection('rawMaterials').doc(id).delete();
  revalidateTag('admin-materials', { expire: 0 });
  return Response.json({ ok: true });
}
