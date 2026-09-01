import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();
  await sql`delete from wallet_transfers where id in ${sql(ids)}`;
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ deleted: ids.length });
}
