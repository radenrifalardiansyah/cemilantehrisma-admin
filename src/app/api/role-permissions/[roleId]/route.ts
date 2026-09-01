import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission, ROLE_PERMISSIONS_TAG } from '@/lib/rbac';
import { FEATURE_KEY_SET } from '@/lib/permissions';
import type { Action } from '@/types/rbac';

type Ctx = { params: Promise<{ roleId: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'role-permissions', 'edit');
  if (guard instanceof Response) return guard;
  const { roleId } = await ctx.params;

  if (roleId === 'super-admin') {
    return Response.json({ error: 'Super Admin selalu memiliki akses penuh dan tidak dapat diubah.' }, { status: 400 });
  }

  const { permissions } = await req.json() as { permissions: Record<string, Partial<Record<Action, boolean>>> };
  if (!permissions || typeof permissions !== 'object') {
    return Response.json({ error: 'permissions wajib diisi.' }, { status: 400 });
  }

  const cleaned: Record<string, Partial<Record<Action, boolean>>> = {};
  for (const [key, cell] of Object.entries(permissions)) {
    if (FEATURE_KEY_SET.has(key)) cleaned[key] = cell;
  }

  const sql = getSql();
  await sql`
    insert into role_permissions (role, permissions, updated_at) values (${roleId}, ${JSON.stringify(cleaned)}::jsonb, now())
    on conflict (role) do update set permissions = excluded.permissions, updated_at = excluded.updated_at
  `;
  // { expire: 0 } instead of the 'max' stale-while-revalidate default — a revoked permission
  // must apply on the very next request, not be served stale once more from cache.
  revalidateTag(ROLE_PERMISSIONS_TAG, { expire: 0 });
  return Response.json({ ok: true });
}
