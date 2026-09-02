import { NextRequest, after } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

// camelCase (field lama Firestore) -> kolom snake_case Postgres.
const COLUMN_MAP: Record<string, string> = {
  name: 'name', emoji: 'emoji', description: 'description', bannerUrl: 'banner_url', order: 'sort_order',
};

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'categories', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const sql = getSql();

  const patch: Record<string, unknown> = {};
  for (const [camelKey, column] of Object.entries(COLUMN_MAP)) {
    if (camelKey in data) patch[column] = data[camelKey];
  }
  if (Object.keys(patch).length > 0) {
    await sql`update categories set ${sql(patch)}, updated_at = now() where id = ${id}`;
  }
  after(() => revalidateStorefront('categories'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'categories', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();

  const [{ count }] = await sql<{ count: string }[]>`select count(*)::int as count from products where category = ${id}`;
  if (Number(count) > 0) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${count} produk masih menggunakan kategori ini.` },
      { status: 400 },
    );
  }

  await sql`delete from categories where id = ${id}`;
  after(() => revalidateStorefront('categories'));
  return Response.json({ ok: true });
}
