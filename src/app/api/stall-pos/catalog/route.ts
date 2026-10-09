import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { guardStall, pricingFromRow, type ConsignPricingRow } from '@/lib/stall-pos-server';
import { parseJsonb } from '@/lib/db';

interface OwnRow { id: string; name: string | null; code: string | null; price: string | null; weight: string | null; emoji: string | null; image_urls: unknown; stock_qty: string }

// Katalog Kasir Lapak: HANYA barang yang ada di lapak ini — titipan (stok titipan lapak) dan
// produk toko (stok gudang terkait lapak). Harga & bagi hasil dihitung di server.
export async function GET(req: NextRequest) {
  const stallId = new URL(req.url).searchParams.get('stallId');
  const guard = await guardStall(req, 'view', stallId);
  if (guard instanceof Response) return guard;
  const { stall } = guard;
  const sql = getSql();

  const consignRows = await sql<(ConsignPricingRow & { image_url: string | null })[]>`
    select si.product_id, p.name, p.code, p.unit, p.image_url, p.default_price, p.scheme as p_scheme, p.scheme_value as p_value,
           si.price as si_price, si.scheme as si_scheme, si.scheme_value as si_value, si.stock_qty,
           c.id as consignor_id, c.name as consignor_name, c.scheme as c_scheme, c.scheme_value as c_value
    from consign_stall_items si
    join consign_products p on p.id = si.product_id
    join consignors c on c.id = p.consignor_id
    where si.stall_id = ${stall.id} and p.is_active and c.is_active
    order by p.name
  `;
  const consign = consignRows.map(r => {
    const pricing = pricingFromRow(r);
    return {
      kind: 'consign' as const, productId: r.product_id, name: r.name, code: r.code ?? '', unit: r.unit, price: pricing.price, imageUrl: r.image_url ?? '',
      stock: Number(r.stock_qty), consignorName: r.consignor_name,
      // Tanpa skema bagi hasil, barang tidak boleh dijual (hutang ke penitip tak bisa dihitung).
      blocked: pricing.spec ? '' : 'Skema bagi hasil belum ditentukan',
    };
  });

  // Produk toko hanya tampil kalau lapak diatur menampilkannya DAN punya gudang terkait.
  const own = stall.warehouse_id && stall.show_own_products
    ? (await sql<OwnRow[]>`
        select p.id, p.name, p.code, p.price, p.weight, p.emoji, p.image_urls, ws.stock_qty
        from warehouse_stock ws join products p on p.id = ws.product_id
        where ws.warehouse_id = ${stall.warehouse_id} and ws.stock_qty > 0
        order by p.name
      `).map(r => ({
        kind: 'own' as const, productId: r.id, name: r.name ?? '', code: r.code ?? '', unit: r.weight ?? 'pcs', price: Number(r.price ?? 0),
        stock: Number(r.stock_qty), emoji: r.emoji ?? '', imageUrl: (parseJsonb<string[]>(r.image_urls as string[] | string | null) ?? [])[0] ?? '',
      }))
    : [];

  return Response.json({ items: [...consign, ...own], hasWarehouse: !!stall.warehouse_id, showOwnProducts: stall.show_own_products });
}
