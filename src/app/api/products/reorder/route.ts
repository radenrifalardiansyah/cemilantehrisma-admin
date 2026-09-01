import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { orders } = await req.json() as { orders: { id: string; order: number }[] };
  if (!Array.isArray(orders) || orders.length === 0)
    return Response.json({ error: 'orders required' }, { status: 400 });

  const sql = getSql();
  await sql.begin(async pgTx => {
    for (const { id, order } of orders) {
      await pgTx`update products set sort_order = ${order}, updated_at = now() where id = ${id}`;
    }
  });
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
