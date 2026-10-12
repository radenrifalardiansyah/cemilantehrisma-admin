import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Stok produk toko yang sekarang ada di gudang lapak + harga jualnya di lapak ini (untuk dokumen Saldo Awal).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-own', 'view');
  if (guard instanceof Response) return guard;
  const stallId = new URL(req.url).searchParams.get('stallId') ?? '';
  const sql = getSql();
  const [stall] = await sql<{ warehouse_id: string | null }[]>`select warehouse_id from stalls where id = ${stallId}`;
  if (!stall?.warehouse_id) return Response.json({ items: [] });
  const rows = await sql<{ product_id: string; name: string | null; qty: string; price: string | null; sp: string | null }[]>`
    select ws.product_id, p.name, ws.stock_qty as qty, p.price, sp.price as sp
    from warehouse_stock ws join products p on p.id = ws.product_id
    left join stall_product_prices sp on sp.stall_id = ${stallId} and sp.product_id = ws.product_id
    where ws.warehouse_id = ${stall.warehouse_id} and ws.stock_qty > 0 order by p.name
  `;
  return Response.json({ items: rows.map(r => ({ productId: r.product_id, name: r.name ?? '', qty: Number(r.qty), price: Number(r.sp ?? r.price ?? 0) })) });
}
