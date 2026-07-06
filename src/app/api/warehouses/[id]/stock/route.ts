import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id: warehouseId } = await ctx.params;
  const db = getDb();

  // Ambil warehouse_stock untuk gudang ini — hanya produk yang benar-benar punya stok di sini
  const stockSnap = await db.collection('warehouse_stock')
    .where('warehouseId', '==', warehouseId)
    .get();

  const entries = stockSnap.docs
    .map(d => d.data())
    .filter(data => ((data.stockQty as number) ?? 0) > 0);

  // Ambil nama produk terbaru (nama bisa berubah setelah dicatat di warehouse_stock)
  const productIds = entries.map(e => e.productId as string);
  const productNames = new Map<string, string>();
  await Promise.all(productIds.map(async id => {
    const doc = await db.collection('products').doc(id).get();
    if (doc.exists) productNames.set(id, doc.data()?.name as string);
  }));

  const stocks = entries
    .map(e => ({
      productId: e.productId as string,
      productName: productNames.get(e.productId as string) ?? (e.productName as string) ?? '',
      stockQty: e.stockQty as number,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  return Response.json({ stocks });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id: warehouseId } = await ctx.params;
  const data = await req.json() as {
    productId: string;
    productName: string;
    warehouseName?: string;
    type: 'in' | 'out';
    qty: number;
    note?: string;
  };

  const { productId, productName, warehouseName, type, qty, note } = data;
  if (!productId || !type || !qty || qty <= 0) {
    return Response.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const db = getDb();
  const delta = type === 'in' ? qty : -qty;

  // Catat entri stok (audit trail)
  await db.collection('stock').add({
    warehouseId,
    warehouseName: warehouseName ?? '',
    productId,
    productName: productName ?? '',
    type,
    qty,
    note: note ?? '',
    createdAt: FieldValue.serverTimestamp(),
  });

  // Upsert warehouse_stock (stok per produk per gudang)
  const wsRef = db.collection('warehouse_stock').doc(`${warehouseId}_${productId}`);
  await wsRef.set(
    {
      warehouseId,
      productId,
      productName,
      stockQty: FieldValue.increment(delta),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return Response.json({ ok: true });
}
