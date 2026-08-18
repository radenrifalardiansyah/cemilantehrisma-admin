import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { readProductsForDeltas, applyStockDelta, writeStockLedgerEntry } from '@/lib/stock';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ productId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'stock', 'view');
  if (guard instanceof Response) return guard;
  const { productId } = await ctx.params;
  const snap = await getDb()
    .collection('stock')
    .where('productId', '==', productId)
    .orderBy('createdAt', 'desc')
    .get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ entries });
}

// Koreksi stok tanpa gudang — dipakai saat stok keluar bukan berasal dari gudang tertentu
// (mis. selisih stok fisik). Tidak menyentuh `warehouse_stock`, hanya total global produk.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'stock', 'create');
  if (guard instanceof Response) return guard;
  const { productId } = await ctx.params;
  const data = await req.json() as { productName?: string; qty?: number; type?: 'in' | 'out'; note?: string };

  const qty = typeof data.qty === 'number' ? data.qty : 0;
  const type = data.type ?? 'out';
  if (!qty || qty <= 0) {
    return Response.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const db = getDb();
  const delta = type === 'in' ? qty : -qty;

  try {
    await db.runTransaction(async tx => {
      const { products, shortages } = await readProductsForDeltas(tx, db, new Map([[productId, delta]]));
      if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

      const product = products.get(productId)!;
      applyStockDelta(tx, db, { productId, product, delta });
      writeStockLedgerEntry(tx, db, {
        productId, type, qty, note: data.note ?? '',
        extra: { productName: data.productName ?? '' },
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mencatat koreksi stok.' }, { status: 400 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
