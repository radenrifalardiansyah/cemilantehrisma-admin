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

  await db.collection('stock').add({
    type: 'transfer',
    fromWarehouseId,
    fromWarehouseName,
    toWarehouseId,
    toWarehouseName,
    productId,
    productName,
    qty,
    note: note ?? '',
    createdAt: FieldValue.serverTimestamp(),
  });

  const fromRef = db.collection('warehouse_stock').doc(`${fromWarehouseId}_${productId}`);
  await fromRef.set(
    { warehouseId: fromWarehouseId, productId, productName, stockQty: FieldValue.increment(-qty), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  const toRef = db.collection('warehouse_stock').doc(`${toWarehouseId}_${productId}`);
  await toRef.set(
    { warehouseId: toWarehouseId, productId, productName, stockQty: FieldValue.increment(qty), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  return Response.json({ ok: true });
}
