import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { ids, published } = await req.json() as { ids: string[]; published: boolean };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();
  await sql`update products set published = ${published}, updated_at = now() where id in ${sql(ids)}`;
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ updated: ids.length });
}
