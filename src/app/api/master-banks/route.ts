import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToBank, type MasterBankRow } from '@/lib/master-banks-pg';

const getCachedBanks = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<MasterBankRow[]>`select * from master_banks order by name asc`;
    return rows.map(rowToBank);
  },
  ['admin-master-banks'],
  { revalidate: 15 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const banks = await getCachedBanks();
  return Response.json({ banks });
}
