import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPo, type PoRow } from '@/lib/purchase-orders-pg';

// Approve massal PO dari centang. Aturannya sama dengan approve satuan: hanya PO DRAFT yang
// disetujui; sisanya dilewati. Tiap PO transaksi sendiri, jadi satu yang gagal tidak menggagalkan yang lain.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'purchase-orders', 'approve');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) return Response.json({ error: 'ids required' }, { status: 400 });
  if (ids.length > 200) return Response.json({ error: 'Maksimal 200 PO sekali approve.' }, { status: 400 });

  const sql = getSql();
  let approved = 0;
  const skipped: { id: string; label: string; reason: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const before = await sql.begin(async pgTx => {
        const [row] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${id} for update`;
        if (!row) return null;
        if (row.status === 'batal') throw new Error('sudah dibatalkan');
        if (row.status !== 'draft') throw new Error('sudah di-approve');
        await pgTx`
          update purchase_orders set status = 'disetujui', approved_by = ${guard.username}, approved_at = now(), updated_at = now()
          where id = ${id}
        `;
        return rowToPo(row);
      });
      if (!before) continue;
      approved++;
      try {
        await logHistory(getDb(), {
          entity: 'purchase-orders', entityId: id, entityLabel: `${before.poNumber} - ${before.supplierName} - approved`,
          action: 'update', actor: guard, before, after: { ...before, status: 'disetujui', approvedBy: guard.username }, meta: { bulk: true },
        });
      } catch (err) { console.error('Failed to write history for PO bulk approve', err); }
    } catch (err) {
      const [r] = await sql<{ po_number: string }[]>`select po_number from purchase_orders where id = ${id}`;
      skipped.push({ id, label: r?.po_number ?? id, reason: err instanceof Error ? err.message : 'gagal' });
    }
  }
  return Response.json({ approved, skipped });
}
