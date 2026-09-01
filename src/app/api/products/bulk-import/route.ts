import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { productUrl } from '@/lib/branding';
import { revalidateStorefront } from '@/lib/revalidate';
import { revalidateTag } from 'next/cache';

interface ImportRow {
  code?: string; name: string; category: string;
  price: number; originalPrice?: number; weight?: string;
  stockQty?: number; openPO?: boolean; badge?: string; description?: string;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'create');
  if (guard instanceof Response) return guard;
  const { products } = await req.json() as { products: ImportRow[] };
  if (!Array.isArray(products) || products.length === 0) {
    return Response.json({ error: 'Tidak ada data produk untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const sql = getSql();
  const [existingRows, settingsSnap] = await Promise.all([
    sql<{ code: string | null }[]>`select code from products`,
    db.collection('settings').doc('main').get(),
  ]);
  const existingCodes = new Set(existingRows.map(r => (r.code ?? '').trim()).filter(Boolean));
  const seenCodes = new Set<string>();

  // Baris dengan stockQty > 0 butuh gudang kasir (Pengaturan) untuk menulis entri warehouse_stock
  // yang sepadan — tanpa gudang, produk akan "tersedia" secara global (products.stockQty) tanpa
  // baris warehouse_stock manapun, melanggar invarian jumlah stok per gudang harus selalu sama
  // dengan total global (lihat lib/stock-pg.ts). Kalau belum dikonfigurasi, produk tetap diimpor
  // tapi stoknya di-nolkan (bukan diam-diam "tersedia" tanpa jejak di gudang manapun) — jumlah
  // yang di-nolkan dikembalikan di respons supaya UI bisa memperingatkan penggunanya.
  const settings = settingsSnap.data() ?? {};
  const warehouseId = settings.posWarehouseId as string | undefined;
  const warehouseName = (settings.posWarehouseName as string | undefined) ?? '';

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0, stockDroppedNoWarehouse = 0;
  const createdWithStock: { id: string; name: string; stockQty: number }[] = [];

  for (const row of products) {
    const name     = (row.name ?? '').toString().trim();
    const category = (row.category ?? '').toString().trim();
    const code     = (row.code ?? '').toString().trim();
    const price    = Number(row.price) || 0;
    if (!name || !category || price <= 0) { skippedInvalid++; continue; }
    if (code && (existingCodes.has(code) || seenCodes.has(code))) { skippedDuplicate++; continue; }

    if (code) seenCodes.add(code);
    const requestedStockQty = Number(row.stockQty) || 0;
    if (requestedStockQty > 0 && !warehouseId) stockDroppedNoWarehouse++;
    const stockQty = warehouseId ? requestedStockQty : 0;
    const openPO   = !!row.openPO;
    const id = randomUUID();

    try {
      await sql`
        insert into products (
          id, name, code, category, price, original_price, weight, description, details, badge,
          emoji, image_urls, gradient, bg_color, stock_qty, open_po, published, stock, qr_url,
          created_at, updated_at
        ) values (
          ${id}, ${name}, ${code}, ${category}, ${price}, ${row.originalPrice || null},
          ${(row.weight ?? '').toString().trim()}, ${(row.description ?? '').toString().trim()},
          ${JSON.stringify([''])}, ${(row.badge ?? '').toString().trim()}, '🛍️', ${JSON.stringify([])},
          'from-amber-700 to-yellow-500', '#B45309', ${stockQty}, ${openPO}, true,
          ${openPO ? 'open_po' : stockQty > 0 ? 'ready' : 'habis'}, ${productUrl(id)}, now(), now()
        )
      `;
      created++;
      if (stockQty > 0) createdWithStock.push({ id, name, stockQty });
    } catch (err) {
      console.error('Bulk import produk: gagal menyimpan baris', name, err);
      skippedInvalid++;
    }
  }

  if (createdWithStock.length > 0 && warehouseId) {
    await sql.begin(async pgTx => {
      for (const p of createdWithStock) {
        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
          values (${`${warehouseId}_${p.id}`}, ${warehouseId}, ${p.id}, ${p.name}, ${p.stockQty}, now())
          on conflict (id) do update set stock_qty = warehouse_stock.stock_qty + excluded.stock_qty, updated_at = now()
        `;
        await pgTx`
          insert into stock_ledger (id, product_id, product_name, warehouse_id, warehouse_name, type, qty, note, created_at)
          values (${randomUUID()}, ${p.id}, ${p.name}, ${warehouseId}, ${warehouseName}, 'in', ${p.stockQty}, 'Impor produk', now())
        `;
      }
    });
  }

  if (created > 0) {
    revalidateTag('admin-products', { expire: 0 });
    after(() => revalidateStorefront('products'));
  }
  return Response.json({ created, skippedInvalid, skippedDuplicate, stockDroppedNoWarehouse });
}
