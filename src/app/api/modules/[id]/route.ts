import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'modules', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as { name?: string; icon?: string; isActive?: boolean };

  const sql = getSql();
  await sql`
    update modules set
      name = coalesce(${data.name ?? null}, name),
      icon = coalesce(${data.icon ?? null}, icon),
      is_active = coalesce(${data.isActive ?? null}, is_active),
      updated_at = now()
    where id = ${id}
  `;
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'modules', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();

  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from menus where module_id = ${id}`;
  if (count > 0) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${count} menu masih berada di modul ini.` },
      { status: 409 },
    );
  }

  await sql`delete from modules where id = ${id}`;
  return Response.json({ ok: true });
}
