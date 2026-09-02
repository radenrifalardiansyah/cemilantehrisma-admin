import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'modules', 'edit');
  if (guard instanceof Response) return guard;

  const { orders } = await req.json() as { orders: { id: string; order: number }[] };
  if (!Array.isArray(orders) || orders.length === 0)
    return Response.json({ error: 'orders required' }, { status: 400 });

  const sql = getSql();
  await sql.begin(async pgTx => {
    for (const { id, order } of orders) {
      await pgTx`update modules set "order" = ${order}, updated_at = now() where id = ${id}`;
    }
  });
  return Response.json({ ok: true });
}
