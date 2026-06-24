import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id: warehouseId } = await ctx.params;
  const db = getDb();

  // Ambil semua produk
  const productsSnap = await db.collection('products').orderBy('createdAt', 'desc').get();
  const products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Array<{ id: string; name: string }>;

  // Ambil warehouse_stock untuk gudang ini
  const stockSnap = await db.collection('warehouse_stock')
    .where('warehouseId', '==', warehouseId)
    .get();

  const stockMap = new Map<string, number>();
  stockSnap.docs.forEach(d => {
    const data = d.data();
    stockMap.set(data.productId as string, data.stockQty as number ?? 0);
  });

  const stocks = products.map(p => ({
    productId: p.id,
    productName: p.name,
    stockQty: stockMap.get(p.id) ?? 0,
  }));

  return Response.json({ stocks });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id: warehouseId } = await ctx.params;
  const data = await req.json() as {
    productId: string;
    productName: string;
    type: 'in' | 'out';
    qty: number;
    note?: string;
  };

  const { productId, productName, type, qty, note } = data;
  if (!productId || !type || !qty || qty <= 0) {
    return Response.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const db = getDb();
  const delta = type === 'in' ? qty : -qty;

  // Catat entri stok (audit trail)
  await db.collection('stock').add({
    warehouseId,
    productId,
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
