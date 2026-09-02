import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { MASTER_BANKS } from '@/lib/master-banks';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const existingRows = await sql<{ code: string }[]>`select code from master_banks`;
  const existingCodes = new Set(existingRows.map(r => r.code));
  let created = 0;

  for (const b of MASTER_BANKS) {
    if (!existingCodes.has(b.code)) created++;
    await sql`
      insert into master_banks (code, name, bank_code, ewallet)
      values (${b.code}, ${b.name}, ${('bankCode' in b ? b.bankCode : null)}, ${('ewallet' in b ? b.ewallet : false)})
      on conflict (code) do update set name = excluded.name, bank_code = excluded.bank_code, ewallet = excluded.ewallet
    `;
  }

  return Response.json({ synced: created, total: MASTER_BANKS.length });
}
