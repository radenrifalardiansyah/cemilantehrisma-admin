import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { lockTransferRow, releaseTransferLinks } from '@/lib/closing-settlement';
import { logLinkChanges } from '@/lib/closing-settlement-history';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();
  // Tautan closing ikut dilepas (FK RESTRICT). Baris transfer dikunci dulu (urut id) supaya tautan yang dibuat
  // bersamaan tidak menyelinap antara pelepasan dan penghapusan.
  const released = await sql.begin(async tx => {
    for (const id of [...new Set(ids.map(String))].sort()) await lockTransferRow(tx, id);
    const rel = await releaseTransferLinks(tx, ids.map(String));
    await tx`delete from wallet_transfers where id in ${tx(ids)}`;
    return rel;
  });
  const byTransfer = new Map<string, typeof released>();
  for (const r of released) { const a = byTransfer.get(r.transferId); if (a) a.push(r); else byTransfer.set(r.transferId, [r]); }
  for (const [transferId, rows] of byTransfer) {
    await logLinkChanges(getDb(), guard, {
      transferId, transferLabel: '', reason: 'Transfer dihapus',
      diff: { added: [], changed: [], removed: rows.map(r => ({ closingId: r.closingId, amount: r.amount })) },
      periodTo: Object.fromEntries(rows.map(r => [r.closingId, r.periodTo])),
    });
  }
  revalidateTag('admin-wallet-transfers', { expire: 0 });
  return Response.json({ deleted: ids.length });
}
