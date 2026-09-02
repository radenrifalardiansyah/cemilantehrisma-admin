import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { referencedMaterialIds } from '@/lib/materials';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const referenced = await referencedMaterialIds();
  const deletable = ids.filter(id => !referenced.has(id));
  const skippedInUse = ids.length - deletable.length;

  const sql = getSql();
  if (deletable.length > 0) {
    await sql`delete from raw_materials where id in ${sql(deletable)}`;
    revalidateTag('admin-materials', { expire: 0 });
  }
  return Response.json({ deleted: deletable.length, skippedInUse });
}
