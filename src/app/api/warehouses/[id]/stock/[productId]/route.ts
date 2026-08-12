import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { clearWarehouseProductStock } from '@/lib/warehouse-stock';
import { logHistory } from '@/lib/history';

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
  const db = getDb();

  const wsRef = db.collection('warehouse_stock').doc(`${warehouseId}_${productId}`);
  const beforeSnap = await wsRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() ?? null : null;

  await clearWarehouseProductStock(warehouseId, productId, 'Kosongkan stok produk');

  try {
    await logHistory(db, {
      entity: 'stock',
      entityId: productId,
      entityLabel: (before?.productName as string) ?? productId,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch {
    // audit log failure must never fail the business request
  }

  return Response.json({ ok: true });
}
