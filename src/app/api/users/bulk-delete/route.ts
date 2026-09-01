import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission, assertCanDeleteUser } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'users', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const deletable = ids.filter(id => assertCanDeleteUser(guard, id).ok);
  const skippedSelf = ids.length - deletable.length;

  const sql = getSql();
  const rows = deletable.length > 0
    ? await sql<{ id: string }[]>`select id from profiles where username in ${sql(deletable)}`
    : [];
  await Promise.all(rows.map(r => getSupabaseAdmin().auth.admin.deleteUser(r.id)));
  if (deletable.length > 0) await sql`delete from profiles where username in ${sql(deletable)}`;

  return Response.json({ deleted: deletable.length, skippedSelf });
}
