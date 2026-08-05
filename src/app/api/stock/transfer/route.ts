import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();

  const data = await req.json() as {
    fromWarehouseId: string;
    fromWarehouseName: string;
    toWarehouseId: string;
    toWarehouseName: string;
    productId: string;
    productName: string;
    qty: number;
    note?: string;
  };

  const {
    fromWarehouseId, fromWarehouseName,
    toWarehouseId, toWarehouseName,
    productId, productName,
    qty, note,
  } = data;

  if (!fromWarehouseId || !toWarehouseId || !productId || !qty || qty <= 0 || fromWarehouseId === toWarehouseId) {
    return Response.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const db = getDb();
  const fromRef = db.collection('warehouse_stock').doc(`${fromWarehouseId}_${productId}`);
  const toRef = db.collection('warehouse_stock').doc(`${toWarehouseId}_${productId}`);

  try {
    await db.runTransaction(async tx => {
      const fromSnap = await tx.get(fromRef);
      const fromQty = typeof fromSnap.data()?.stockQty === 'number' ? fromSnap.data()!.stockQty as number : 0;
      if (fromQty < qty) {
        throw new Error(`Stok ${productName} di ${fromWarehouseName} tidak cukup (tersisa ${fromQty}, butuh ${qty})`);
      }

      tx.set(fromRef, {
        warehouseId: fromWarehouseId, productId, productName,
        stockQty: FieldValue.increment(-qty), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(toRef, {
        warehouseId: toWarehouseId, productId, productName,
        stockQty: FieldValue.increment(qty), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const stockRef = db.collection('stock').doc();
      tx.set(stockRef, {
        type: 'transfer',
        fromWarehouseId, fromWarehouseName, toWarehouseId, toWarehouseName,
        productId, productName, qty, note: note ?? '',
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal transfer stok.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}
