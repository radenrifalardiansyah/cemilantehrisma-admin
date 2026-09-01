import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission, ROLE_PERMISSIONS_TAG } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'roles', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;

  if (id === 'super-admin') {
    return Response.json({ error: 'Role Super Admin adalah role sistem dan tidak dapat diubah.' }, { status: 400 });
  }

  const data = await req.json() as { name?: string; description?: string };
  const sql = getSql();
  const [existing] = await sql<{ name: string; description: string | null }[]>`select name, description from roles where id = ${id}`;
  if (!existing) return Response.json({ error: 'Role tidak ditemukan.' }, { status: 404 });

  await sql`
    update roles set name = ${data.name ?? existing.name}, description = ${data.description ?? existing.description}, updated_at = now()
    where id = ${id}
  `;
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'roles', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;

  if (id === 'super-admin' || id === 'admin') {
    return Response.json({ error: 'Role sistem tidak dapat dihapus.' }, { status: 400 });
  }

  const sql = getSql();
  const [usedBy] = await sql<{ count: string }[]>`select count(*)::int as count from profiles where role = ${id}`;
  if (Number(usedBy.count) > 0) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${usedBy.count} pengguna masih menggunakan role ini.` },
      { status: 409 },
    );
  }

  await sql`delete from roles where id = ${id}`;
  revalidateTag(ROLE_PERMISSIONS_TAG, { expire: 0 });
  return Response.json({ ok: true });
}
