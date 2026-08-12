import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { clearWarehouseProductStock } from '@/lib/warehouse-stock';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

// Kosongkan stok semua produk di gudang ini ke 0 sekaligus (mis. reset stock opname)
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id: warehouseId } = await ctx.params;
  const db = getDb();

  const stockSnap = await db.collection('warehouse_stock')
    .where('warehouseId', '==', warehouseId)
    .get();
  const productIds = stockSnap.docs
    .filter(d => ((d.data().stockQty as number) ?? 0) > 0)
    .map(d => d.data().productId as string);

  await Promise.all(productIds.map(productId =>
    clearWarehouseProductStock(warehouseId, productId, 'Kosongkan semua stok gudang')
  ));

  try {
    const warehouseSnap = await db.collection('warehouses').doc(warehouseId).get();
    await logHistory(db, {
      entity: 'stock',
      entityId: warehouseId,
      entityLabel: (warehouseSnap.data()?.name as string) ?? warehouseId,
      action: 'delete',
      actor: guard,
      meta: { clearedProductCount: productIds.length },
    });
  } catch {
    // audit log failure must never fail the business request
  }

  return Response.json({ ok: true, cleared: productIds.length });
}
