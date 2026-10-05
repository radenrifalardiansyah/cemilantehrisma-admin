import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { guardWalletBalances, WalletBalanceError } from '@/lib/wallet-balance';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'capital', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const validIds = ids.filter((i): i is string => typeof i === 'string');
  if (validIds.length === 0) return Response.json({ error: 'ids required' }, { status: 400 });
  const sql = getSql();
  let deleted = 0;
  try {
    await sql.begin(async pgTx => {
      const rows = await pgTx<{ id: string; wallet_id: string | null }[]>`select id, wallet_id from capital_entries where id in ${pgTx(validIds)}`;
      await guardWalletBalances(pgTx, rows.map(r => r.wallet_id), async () => {
        await pgTx`delete from capital_entries where id in ${pgTx(rows.map(r => r.id))}`;
      });
      deleted = rows.length;
    });
  } catch (err) {
    if (err instanceof WalletBalanceError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  revalidateTag('admin-capital', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ deleted });
}
