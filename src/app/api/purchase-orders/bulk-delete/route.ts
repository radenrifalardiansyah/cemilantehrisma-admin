import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPo, type PoRow } from '@/lib/purchase-orders-pg';

// Hapus massal PO dari centang. Aturannya sama dengan hapus satuan: hanya PO DRAFT yang belum punya
// GR yang dihapus permanen; sisanya dilewati (PO yang sudah dikirim cukup dibatalkan satu per satu).
// Tiap PO transaksi sendiri, jadi satu yang gagal tidak menggagalkan yang lain.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) return Response.json({ error: 'ids required' }, { status: 400 });
  if (ids.length > 200) return Response.json({ error: 'Maksimal 200 PO sekali hapus.' }, { status: 400 });

  const sql = getSql();
  let deleted = 0;
  const skipped: { id: string; label: string; reason: string }[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const before = await sql.begin(async pgTx => {
        const [row] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${id} for update`;
        if (!row) return null;
        if (row.status !== 'draft') throw new Error('bukan draft');
        const [{ exists }] = await pgTx<{ exists: boolean }[]>`select exists(select 1 from goods_receipts where po_id = ${id}) as exists`;
        if (exists) throw new Error('sudah punya GR');
        await pgTx`delete from purchase_orders where id = ${id}`;
        return rowToPo(row);
      });
      if (!before) continue;
      deleted++;
      try {
        await logHistory(getDb(), { entity: 'purchase-orders', entityId: id, entityLabel: `${before.poNumber} - ${before.supplierName}`, action: 'delete', actor: guard, before, meta: { bulk: true } });
      } catch (err) { console.error('Failed to write history for PO bulk delete', err); }
    } catch (err) {
      const [r] = await sql<{ po_number: string }[]>`select po_number from purchase_orders where id = ${id}`;
      skipped.push({ id, label: r?.po_number ?? id, reason: err instanceof Error ? err.message : 'gagal' });
    }
  }
  return Response.json({ deleted, skipped });
}
