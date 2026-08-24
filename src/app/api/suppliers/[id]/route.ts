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
  const db = getDb();

  // Tolak kalau supplier ini masih punya riwayat pembelian bahan baku — kalau dibolehkan,
  // materialPurchases.supplierId jadi menunjuk ke dokumen yang sudah tidak ada.
  const purchaseRef = await db.collection('materialPurchases').where('supplierId', '==', id).limit(1).get();
  if (!purchaseRef.empty) {
    return Response.json(
      { error: 'Supplier ini masih punya riwayat pembelian bahan baku — tidak bisa dihapus.' },
      { status: 400 },
    );
  }

  await db.collection('suppliers').doc(id).delete();
  return Response.json({ ok: true });
}
