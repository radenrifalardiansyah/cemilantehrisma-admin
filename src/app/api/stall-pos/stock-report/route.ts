import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { seq } from '@/lib/db-seq';
import { guardStall } from '@/lib/stall-pos-server';

// Update stok titipan satu lapak untuk dikirim ke grup WhatsApp penitip: semua produk titipan per penitip
// dengan stok saat ini, plus terjual & masuk SEJAK update terakhir yang dikirim (kalau ada).
export async function GET(req: NextRequest) {
  const guard = await guardStall(req, 'view', new URL(req.url).searchParams.get('stallId'));
  if (guard instanceof Response) return guard;
  const { stall } = guard;
  const sql = getSql();
  const [last] = await sql<{ created_at: Date }[]>`select created_at from stall_stock_updates where stall_id = ${stall.id} order by created_at desc limit 1`;
  const since = last?.created_at ?? null;

  const [items, sold, received] = await seq([
    sql<{ product_id: string; name: string; unit: string; consignor_id: string; consignor_name: string; stock_qty: string }[]>`
      select si.product_id, p.name, p.unit, c.id as consignor_id, c.name as consignor_name, si.stock_qty
      from consign_stall_items si
      join consign_products p on p.id = si.product_id
      join consignors c on c.id = p.consignor_id
      where si.stall_id = ${stall.id} and p.is_active and c.is_active
      order by c.name, p.name
    `,
    since ? sql<{ product_id: string; qty: string }[]>`
      select product_id, sum(qty) as qty from consign_sale_lines
      where stall_id = ${stall.id} and source = 'sale' and not voided and created_at > ${since}
      group by product_id
    ` : Promise.resolve([] as { product_id: string; qty: string }[]),
    since ? sql<{ product_id: string; qty: string }[]>`
      select it->>'productId' as product_id, sum((it->>'qty')::numeric) as qty
      from consign_receipts r, jsonb_array_elements(r.items) it
      where r.created_at > ${since} and ((r.kind = 'in' and r.stall_id = ${stall.id}) or (r.kind = 'transfer' and r.to_stall_id = ${stall.id}))
      group by it->>'productId'
    ` : Promise.resolve([] as { product_id: string; qty: string }[]),
  ]);
  const soldBy = new Map(sold.map(r => [r.product_id, Number(r.qty)]));
  const recvBy = new Map(received.map(r => [r.product_id, Number(r.qty)]));

  const consignors: { id: string; name: string; products: { id: string; name: string; unit: string; stock: number; sold: number; received: number }[] }[] = [];
  for (const i of items) {
    let c = consignors.find(x => x.id === i.consignor_id);
    if (!c) { c = { id: i.consignor_id, name: i.consignor_name, products: [] }; consignors.push(c); }
    c.products.push({ id: i.product_id, name: i.name, unit: i.unit, stock: Number(i.stock_qty), sold: soldBy.get(i.product_id) ?? 0, received: recvBy.get(i.product_id) ?? 0 });
  }
  return Response.json({
    stall: { id: stall.id, name: stall.name },
    lastUpdateAt: since ? since.toISOString() : null,
    generatedAt: new Date().toISOString(),
    consignors,
  });
}

// Catat bahwa update stok dikirim sekarang — jadi batas "sejak update sebelumnya" untuk update berikutnya.
export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({})) as { stallId?: string };
  const guard = await guardStall(req, 'view', typeof data.stallId === 'string' ? data.stallId : null);
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const id = randomUUID();
  const [row] = await sql<{ created_at: Date }[]>`
    insert into stall_stock_updates (id, stall_id, created_by, created_at) values (${id}, ${guard.stall.id}, ${guard.user.username}, now()) returning created_at
  `;
  return Response.json({ at: row.created_at.toISOString() });
}
