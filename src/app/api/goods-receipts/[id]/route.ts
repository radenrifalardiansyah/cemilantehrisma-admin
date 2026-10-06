import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToGr, receivedByMaterial, buildGrItems, type GrRow, type GrItemInput, type PoItem } from '@/lib/purchase-orders-pg';
import { parseJsonb } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [row] = await sql<GrRow[]>`
    select g.*, po.po_number, po.supplier_name from goods_receipts g join purchase_orders po on po.id = g.po_id where g.id = ${id}
  `;
  if (!row) return Response.json({ error: 'GR tidak ditemukan.' }, { status: 404 });
  return Response.json({ goodsReceipt: rowToGr(row) });
}

// Edit GR hanya saat draft: qty yang benar-benar datang, harga di nota supplier,
// tanggal terima, catatan, serta dompet/status bayar (boleh diisi dulu, final saat approve).
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    items: GrItemInput[]; receivedDate?: string; note?: string;
    walletId?: string | null; paymentStatus?: 'lunas' | 'belum_lunas';
  };
  const sql = getSql();
  let before: ReturnType<typeof rowToGr>;
  let total = 0;
  try {
    before = await sql.begin(async pgTx => {
      const [probe] = await pgTx<{ po_id: string }[]>`select po_id from goods_receipts where id = ${id}`;
      if (!probe) throw new Error('GR tidak ditemukan.');
      // Urutan kunci sama dengan approve: PO dulu, baru GR.
      const [po] = await pgTx<{ items: unknown }[]>`select items from purchase_orders where id = ${probe.po_id} for update`;
      const [row] = await pgTx<GrRow[]>`select * from goods_receipts where id = ${id} for update`;
      if (row.status !== 'draft') throw new Error('Hanya GR draft yang bisa diubah.');
      const poItems = (parseJsonb(po.items as string | PoItem[] | null) as PoItem[] | null) ?? [];
      const items = buildGrItems(poItems, await receivedByMaterial(pgTx, probe.po_id), data.items ?? []);
      total = items.reduce((s, it) => s + it.subtotal, 0);
      await pgTx`
        update goods_receipts set
          items = ${JSON.stringify(items)}, total = ${total}, received_date = ${data.receivedDate || row.received_date},
          note = ${data.note ?? ''},
          wallet_id = ${data.walletId ?? null}, payment_status = ${data.paymentStatus ?? null}, updated_at = now()
        where id = ${id}
      `;
      return rowToGr(row);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan GR.' }, { status: 400 });
  }
  try {
    await logHistory(getDb(), {
      entity: 'goods-receipts', entityId: id, entityLabel: `${before.grNumber} - Rp${total}`,
      action: 'update', actor: guard, before, after: { ...before, total },
    });
  } catch (err) {
    console.error('Failed to write history for GR update', err);
  }
  return Response.json({ ok: true });
}

// Hapus permanen cuma untuk GR draft; GR yang sudah approve/dibatalkan tetap ada sebagai jejak audit.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  let before: ReturnType<typeof rowToGr>;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<GrRow[]>`select * from goods_receipts where id = ${id} for update`;
      if (!row) throw new Error('GR tidak ditemukan.');
      if (row.status !== 'draft') throw new Error('Hanya GR draft yang bisa dihapus.');
      await pgTx`delete from goods_receipts where id = ${id}`;
      return rowToGr(row);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus GR.' }, { status: 400 });
  }
  try {
    await logHistory(getDb(), {
      entity: 'goods-receipts', entityId: id, entityLabel: `${before.grNumber}`, action: 'delete', actor: guard, before,
    });
  } catch (err) {
    console.error('Failed to write history for GR delete', err);
  }
  return Response.json({ ok: true });
}
