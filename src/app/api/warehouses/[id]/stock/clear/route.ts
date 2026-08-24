import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { clearWarehouseStockForProducts } from '@/lib/warehouse-stock';
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

  const { cleared, failed } = await clearWarehouseStockForProducts(warehouseId, productIds, 'Kosongkan semua stok gudang');

  try {
    const warehouseSnap = await db.collection('warehouses').doc(warehouseId).get();
    await logHistory(db, {
      entity: 'stock',
      entityId: warehouseId,
      entityLabel: (warehouseSnap.data()?.name as string) ?? warehouseId,
      action: 'delete',
      actor: guard,
      meta: { clearedProductCount: cleared.length, failedProductCount: failed.length },
    });
  } catch {
    // audit log failure must never fail the business request
  }

  // 200 dengan daftar `failed` (bukan 500) — sebagian produk yang berhasil dikosongkan tetap
  // permanen ter-commit, jadi ini bukan kegagalan request secara keseluruhan; UI perlu tahu
  // persis mana yang gagal supaya bisa dicoba ulang, bukan cuma "gagal, coba lagi" generik.
  return Response.json({ ok: true, cleared: cleared.length, failed });
}
