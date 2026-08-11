import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { clearWarehouseProductStock } from '@/lib/warehouse-stock';

type Ctx = { params: Promise<{ id: string; productId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const { id: warehouseId, productId } = await ctx.params;

  const snap = await getDb()
    .collection('stock')
    .where('warehouseId', '==', warehouseId)
    .where('productId', '==', productId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ entries });
}

// Kosongkan stok produk ini ke 0 di gudang ini (mis. hasil stock opname)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id: warehouseId, productId } = await ctx.params;
  await clearWarehouseProductStock(warehouseId, productId, 'Kosongkan stok produk');
  return Response.json({ ok: true });
}
