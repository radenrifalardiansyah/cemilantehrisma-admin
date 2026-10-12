import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { auditConsign } from '@/lib/consign-audit';

// Harga jual produk toko per lapak. Produk tanpa harga khusus ikut harga toko.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-own', 'view');
  if (guard instanceof Response) return guard;
  const sp0 = new URL(req.url).searchParams;
  const stallId = sp0.get('stallId') ?? '';
  const otherWarehouseId = sp0.get('warehouseId') ?? '';   // gudang asal/tujuan dokumen — untuk menampilkan stoknya
  const sql = getSql();
  const [stall] = await sql<{ warehouse_id: string | null }[]>`select warehouse_id from stalls where id = ${stallId}`;
  if (!stall) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 404 });
  const rows = await sql<{ id: string; name: string | null; code: string | null; price: string | null; sp: string | null; qty: string | null; oqty: string | null }[]>`
    select p.id, p.name, p.code, p.price, sp.price as sp, ws.stock_qty as qty, wo.stock_qty as oqty
    from products p
    left join stall_product_prices sp on sp.stall_id = ${stallId} and sp.product_id = p.id
    left join warehouse_stock ws on ws.warehouse_id = ${stall.warehouse_id} and ws.product_id = p.id
    left join warehouse_stock wo on wo.warehouse_id = ${otherWarehouseId} and wo.product_id = p.id
    order by p.name
  `;
  return Response.json({
    items: rows.map(r => ({ productId: r.id, name: r.name ?? '', code: r.code ?? '', tokoPrice: Number(r.price ?? 0), stallPrice: r.sp === null ? null : Number(r.sp), stock: Number(r.qty ?? 0), otherStock: Number(r.oqty ?? 0) })),
  });
}

// price null = hapus harga khusus (kembali ikut harga toko).
export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-own', 'edit');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const stallId = typeof data.stallId === 'string' ? data.stallId : '';
  const productId = typeof data.productId === 'string' ? data.productId : '';
  const price = data.price === null ? null : Number(data.price);
  if (!stallId || !productId || (price !== null && (!Number.isFinite(price) || price < 0))) return Response.json({ error: 'Data tidak valid.' }, { status: 400 });
  const sql = getSql();
  const [stall] = await sql<{ name: string }[]>`select name from stalls where id = ${stallId}`;
  const [product] = await sql<{ name: string | null }[]>`select name from products where id = ${productId}`;
  if (!stall || !product) return Response.json({ error: 'Lapak atau produk tidak ditemukan.' }, { status: 400 });
  const [before] = await sql<{ price: string }[]>`select price from stall_product_prices where stall_id = ${stallId} and product_id = ${productId}`;
  if (price === null) await sql`delete from stall_product_prices where stall_id = ${stallId} and product_id = ${productId}`;
  else await sql`
    insert into stall_product_prices (stall_id, product_id, price, updated_at) values (${stallId}, ${productId}, ${price}, now())
    on conflict (stall_id, product_id) do update set price = excluded.price, updated_at = now()
  `;
  await auditConsign(guard, 'update', 'stall-prices', `${stallId}_${productId}`, `Harga ${product.name} di ${stall.name}`, before ? { price: Number(before.price) } : null, { price });
  return Response.json({ ok: true });
}
