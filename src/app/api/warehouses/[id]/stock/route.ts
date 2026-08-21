import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { readProductsForDeltas, applyStockDelta, writeStockLedgerEntry } from '@/lib/stock';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const { id: warehouseId } = await ctx.params;
  const db = getDb();

  // Ambil warehouse_stock untuk gudang ini — hanya produk yang benar-benar punya stok di sini
  const stockSnap = await db.collection('warehouse_stock')
    .where('warehouseId', '==', warehouseId)
    .get();

  const entries = stockSnap.docs
    .map(d => d.data())
    .filter(data => ((data.stockQty as number) ?? 0) > 0);

  // Ambil nama produk terbaru (nama bisa berubah setelah dicatat di warehouse_stock) —
  // satu batchGet (getAll) alih-alih N .get() terpisah, satu round trip ke Firestore.
  const productIds = [...new Set(entries.map(e => e.productId as string))];
  const productNames = new Map<string, string>();
  if (productIds.length > 0) {
    const productDocs = await db.getAll(...productIds.map(id => db.collection('products').doc(id)));
    productDocs.forEach((doc, i) => { if (doc.exists) productNames.set(productIds[i], doc.data()?.name as string); });
  }

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
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
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

  try {
    await db.runTransaction(async tx => {
      const { products, shortages } = await readProductsForDeltas(tx, db, new Map([[productId, delta]]));
      if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

      const product = products.get(productId)!;
      applyStockDelta(tx, db, { productId, product, warehouseId, delta });
      writeStockLedgerEntry(tx, db, {
        productId, warehouseId, warehouseName, type, qty, note: note ?? '',
        extra: { productName: productName ?? '' },
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mencatat transaksi stok.' }, { status: 400 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
