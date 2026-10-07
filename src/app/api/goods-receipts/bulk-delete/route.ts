import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToGr, type GrRow } from '@/lib/purchase-orders-pg';

// Hapus massal GR dari centang — hanya GR DRAFT (sama dengan hapus satuan). GR yang sudah approve
// atau dibatalkan tetap ada sebagai jejak audit dan dilewati.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) return Response.json({ error: 'ids required' }, { status: 400 });
  if (ids.length > 200) return Response.json({ error: 'Maksimal 200 GR sekali hapus.' }, { status: 400 });

  const sql = getSql();
  let deleted = 0;
  const skipped: { id: string; label: string; reason: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const before = await sql.begin(async pgTx => {
        const [row] = await pgTx<GrRow[]>`select * from goods_receipts where id = ${id} for update`;
        if (!row) return null;
        if (row.status !== 'draft') throw new Error(row.status === 'approved' ? 'sudah di-approve' : 'sudah dibatalkan');
        await pgTx`delete from goods_receipts where id = ${id}`;
        return rowToGr(row);
      });
      if (!before) continue;
      deleted++;
      try {
        await logHistory(getDb(), { entity: 'goods-receipts', entityId: id, entityLabel: before.grNumber, action: 'delete', actor: guard, before, meta: { bulk: true } });
      } catch (err) { console.error('Failed to write history for GR bulk delete', err); }
    } catch (err) {
      const [r] = await sql<{ gr_number: string }[]>`select gr_number from goods_receipts where id = ${id}`;
      skipped.push({ id, label: r?.gr_number ?? id, reason: err instanceof Error ? err.message : 'gagal' });
    }
  }
  return Response.json({ deleted, skipped });
}
