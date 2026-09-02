import { NextRequest, after } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'reviews', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const { approved } = await req.json() as { approved?: boolean };
  if (typeof approved !== 'boolean') {
    return Response.json({ error: 'Field "approved" wajib berupa boolean.' }, { status: 400 });
  }

  const sql = getSql();
  await sql`update reviews set approved = ${approved}, updated_at = now() where id = ${id}`;
  after(() => revalidateStorefront('stats'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'reviews', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;

  const sql = getSql();
  await sql`delete from reviews where id = ${id}`;
  after(() => revalidateStorefront('stats'));
  return Response.json({ ok: true });
}
