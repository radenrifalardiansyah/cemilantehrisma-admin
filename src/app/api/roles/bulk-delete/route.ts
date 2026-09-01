import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission, ROLE_PERMISSIONS_TAG } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'roles', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();
  const rolesInUseRows = await sql<{ role: string }[]>`select distinct role from profiles`;
  const rolesInUse = new Set(rolesInUseRows.map(r => r.role));

  const deletable: string[] = [];
  let skippedSystem = 0;
  let skippedInUse = 0;
  for (const id of ids) {
    if (id === 'super-admin' || id === 'admin') { skippedSystem++; continue; }
    if (rolesInUse.has(id)) { skippedInUse++; continue; }
    deletable.push(id);
  }

  if (deletable.length > 0) {
    // role_permissions ikut terhapus lewat "on delete cascade" di foreign key-nya.
    await sql`delete from roles where id in ${sql(deletable)}`;
    revalidateTag(ROLE_PERMISSIONS_TAG, { expire: 0 });
  }

  return Response.json({ deleted: deletable.length, skippedSystem, skippedInUse });
}
