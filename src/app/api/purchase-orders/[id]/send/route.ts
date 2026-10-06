import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPo, type PoRow } from '@/lib/purchase-orders-pg';

type Ctx = { params: Promise<{ id: string }> };

// Dipanggil saat tombol "Kirim WA" diklik: tandai PO draft → terkirim (dikunci dari edit) dan
// kembalikan token untuk link PDF publik. Aman dipanggil berulang (kirim ulang WA) — PO yang sudah
// terkirim/diterima cuma dikembalikan tokennya tanpa mengubah status.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  let row: PoRow;
  let changed = false;
  try {
    ({ row, changed } = await sql.begin(async pgTx => {
      const [r] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${id} for update`;
      if (!r) throw new Error('PO tidak ditemukan.');
      if (r.status === 'batal') throw new Error('PO ini sudah dibatalkan.');
      if (r.status === 'draft') {
        await pgTx`update purchase_orders set status = 'terkirim', sent_at = now(), updated_at = now() where id = ${id}`;
        return { row: { ...r, status: 'terkirim' }, changed: true };
      }
      return { row: r, changed: false };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menandai PO terkirim.' }, { status: 400 });
  }
  if (changed) {
    try {
      await logHistory(getDb(), {
        entity: 'purchase-orders', entityId: id, entityLabel: `${row.po_number} - ${row.supplier_name}`,
        action: 'update', actor: guard, before: { status: 'draft' }, after: { status: 'terkirim' },
      });
    } catch (err) {
      console.error('Failed to write history for PO send', err);
    }
  }
  return Response.json({ purchaseOrder: rowToPo(row, { includeToken: true }) });
}
