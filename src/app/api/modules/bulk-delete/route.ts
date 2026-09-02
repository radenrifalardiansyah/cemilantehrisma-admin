import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'modules', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();
  const linkedRows = await sql<{ module_id: string }[]>`select distinct module_id from menus where module_id in ${sql(ids)}`;
  const modulesInUse = new Set(linkedRows.map(r => r.module_id));
  const deletable = ids.filter(id => !modulesInUse.has(id));
  const skippedInUse = ids.length - deletable.length;

  if (deletable.length > 0) await sql`delete from modules where id in ${sql(deletable)}`;
  return Response.json({ deleted: deletable.length, skippedInUse });
}
