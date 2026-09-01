import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { productUrl } from '@/lib/branding';
import { revalidateStorefront } from '@/lib/revalidate';
import { rowToProduct, productPatchFromBody, type ProductRow } from '@/lib/products-pg';

// Short cache so bursts of near-simultaneous reads (dashboard load, POS stock
// refresh, multiple staff/tabs) collapse into one Postgres read instead of one
// each. Tagged so create/update/delete can invalidate it immediately instead of
// waiting out the 15s TTL.
const getCachedProducts = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<ProductRow[]>`select * from products order by created_at desc`;
    return rows.map(rowToProduct);
  },
  ['admin-products'],
  { revalidate: 15, tags: ['admin-products'] }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'view');
  if (guard instanceof Response) return guard;
  const products = await getCachedProducts();
  return Response.json({ products });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const sql = getSql();
  const id = randomUUID();
  const qrUrl = (data.qrUrl as string | undefined)?.trim() || productUrl(id);
  const patch = productPatchFromBody(data);

  await sql`insert into products ${sql({ id, ...patch, qr_url: qrUrl, created_at: new Date(), updated_at: new Date() })}`;
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ id, qrUrl });
}
