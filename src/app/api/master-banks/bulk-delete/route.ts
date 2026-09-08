import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'delete');
  if (guard instanceof Response) return guard;
  const { codes } = await req.json() as { codes: string[] };
  if (!Array.isArray(codes) || codes.length === 0)
    return Response.json({ error: 'codes required' }, { status: 400 });

  const sql = getSql();
  await sql`delete from master_banks where code in ${sql(codes)}`;
  revalidateTag('admin-master-banks', { expire: 0 });
  return Response.json({ deleted: codes.length });
}
