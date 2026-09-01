import { NextRequest, after } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const { id: warehouseId } = await ctx.params;
  const sql = getSql();

  // Ambil warehouse_stock untuk gudang ini — hanya produk yang benar-benar punya stok di sini.
  // Nama produk diambil langsung dari products (JOIN) supaya selalu yang terbaru (bisa berubah
  // setelah dicatat di warehouse_stock), dengan fallback ke nama yang tersimpan di warehouse_stock
  // sendiri kalau produknya sudah dihapus.
  const rows = await sql<{ product_id: string; product_name: string | null; stock_qty: string; name: string | null }[]>`
    select ws.product_id, ws.product_name, ws.stock_qty, p.name
    from warehouse_stock ws
    left join products p on p.id = ws.product_id
    where ws.warehouse_id = ${warehouseId} and ws.stock_qty > 0
  `;

  const stocks = rows
    .map(r => ({
      productId: r.product_id,
      productName: r.name ?? r.product_name ?? '',
      stockQty: Number(r.stock_qty) || 0,
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

  const { productId, warehouseName, type, qty, note } = data;
  if (!productId || !type || !qty || qty <= 0) {
    return Response.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const sql = getSql();
  const delta = type === 'in' ? qty : -qty;

  try {
    await sql.begin(async pgTx => {
      const { products, shortages } = await readProductsForDeltasPg(pgTx, new Map([[productId, delta]]));
      if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

      const product = products.get(productId)!;
      await applyStockDeltaPg(pgTx, { productId, product, warehouseId, delta });
      await writeStockLedgerEntryPg(pgTx, {
        productId, productName: product.name, warehouseId, warehouseName, type, qty, note: note ?? '',
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mencatat transaksi stok.' }, { status: 400 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
