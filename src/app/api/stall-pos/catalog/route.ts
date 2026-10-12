import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { guardStall } from '@/lib/stall-pos-server';
import { loadConsignCatalog } from '@/lib/store-consign';
import { parseJsonb } from '@/lib/db';

interface OwnRow { id: string; name: string | null; code: string | null; price: string | null; weight: string | null; emoji: string | null; image_urls: unknown; stock_qty: string; category_name: string | null; description: string | null }

// Katalog Kasir Lapak: HANYA barang yang ada di lapak ini — titipan (stok titipan lapak) dan
// produk toko (stok gudang terkait lapak). Harga & bagi hasil dihitung di server.
export async function GET(req: NextRequest) {
  const stallId = new URL(req.url).searchParams.get('stallId');
  const guard = await guardStall(req, 'view', stallId);
  if (guard instanceof Response) return guard;
  const { stall } = guard;
  const sql = getSql();

  const consign = await loadConsignCatalog(sql, stall.id);

  // Produk toko hanya tampil kalau lapak diatur menampilkannya DAN punya gudang terkait.
  const ownPrices = new Map((await sql<{ product_id: string; price: string }[]>`select product_id, price from stall_product_prices where stall_id = ${stall.id}`).map(r => [r.product_id, Number(r.price)]));
  const own = stall.warehouse_id && stall.show_own_products
    ? (await sql<OwnRow[]>`
        select p.id, p.name, p.code, p.price, p.weight, p.emoji, p.image_urls, ws.stock_qty, cat.name as category_name, p.description
        from warehouse_stock ws join products p on p.id = ws.product_id left join categories cat on cat.id = p.category
        where ws.warehouse_id = ${stall.warehouse_id} and ws.stock_qty > 0
        order by p.name
      `).map(r => ({
        kind: 'own' as const, productId: r.id, name: r.name ?? '', code: r.code ?? '', unit: 'pcs', weight: r.weight ?? '', description: r.description ?? '', category: r.category_name ?? '', price: ownPrices.get(r.id) ?? Number(r.price ?? 0),
        stock: Number(r.stock_qty), emoji: r.emoji ?? '', imageUrl: (parseJsonb<string[]>(r.image_urls as string[] | string | null) ?? [])[0] ?? '',
      }))
    : [];

  return Response.json({ items: [...consign, ...own], hasWarehouse: !!stall.warehouse_id, showOwnProducts: stall.show_own_products });
}
