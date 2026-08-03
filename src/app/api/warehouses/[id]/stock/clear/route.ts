import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { clearWarehouseProductStock } from '@/lib/warehouse-stock';

type Ctx = { params: Promise<{ id: string }> };

// Kosongkan stok semua produk di gudang ini ke 0 sekaligus (mis. reset stock opname)
export async function POST(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
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

  return Response.json({ ok: true, cleared: productIds.length });
}
