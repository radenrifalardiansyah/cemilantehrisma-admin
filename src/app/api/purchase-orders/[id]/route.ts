import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { invalidPurchaseItemMessage } from '@/lib/validate-items';
import { logHistory } from '@/lib/history';
import { rowToPo, rowToGr, receivedByMaterial, remainingItems, type PoRow, type GrRow, type PoItem } from '@/lib/purchase-orders-pg';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [row] = await sql<PoRow[]>`select * from purchase_orders where id = ${id}`;
  if (!row) return Response.json({ error: 'PO tidak ditemukan.' }, { status: 404 });
  const grRows = await sql<GrRow[]>`select * from goods_receipts where po_id = ${id} order by created_at desc`;
  const po = rowToPo(row);
  const received = await sql.begin(pgTx => receivedByMaterial(pgTx, id));
  return Response.json({
    purchaseOrder: po,
    goodsReceipts: grRows.map(r => rowToGr(r)),
    remaining: remainingItems(po.items, received),
  });
}

// Edit hanya boleh selama PO masih draft (belum dikirim ke supplier) — setelah itu isinya sudah
// jadi dokumen yang dipegang supplier, jadi perubahan harus lewat batal + buat PO baru.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    supplierId?: string | null; supplierName?: string; supplierPhone?: string;
    date?: string; expectedDate?: string | null; note?: string;
    items: { materialId: string; materialName: string; unit: string; qty: number; price: number }[];
  };
  const items = data.items ?? [];
  if (items.length === 0) return Response.json({ error: 'Minimal 1 bahan baku.' }, { status: 400 });
  const itemError = invalidPurchaseItemMessage(items);
  if (itemError) return Response.json({ error: itemError }, { status: 400 });
  if (!data.supplierName?.trim()) return Response.json({ error: 'Nama supplier wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const poItems: PoItem[] = items.map(it => ({ ...it, subtotal: it.qty * it.price }));
  const total = poItems.reduce((s, it) => s + it.subtotal, 0);
  let before: ReturnType<typeof rowToPo>;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${id} for update`;
      if (!row) throw new Error('PO tidak ditemukan.');
      if (row.status !== 'draft') throw new Error('PO yang sudah dikirim tidak bisa diubah. Batalkan lalu buat PO baru.');
      const ids = [...new Set(items.map(it => it.materialId))];
      const found = await pgTx<{ id: string }[]>`select id from raw_materials where id in ${pgTx(ids)}`;
      if (found.length !== ids.length) throw new Error('Ada bahan baku yang tidak ditemukan.');
      let phone = data.supplierPhone?.trim() ?? '';
      if (data.supplierId) {
        const [sup] = await pgTx<{ phone: string }[]>`select phone from suppliers where id = ${data.supplierId}`;
        if (!sup) throw new Error('Supplier tidak ditemukan.');
        if (!phone) phone = sup.phone ?? '';
      }
      await pgTx`
        update purchase_orders set
          supplier_id = ${data.supplierId ?? null}, supplier_name = ${data.supplierName!.trim()}, supplier_phone = ${phone},
          items = ${JSON.stringify(poItems)}, total = ${total}, date = ${data.date || row.date},
          expected_date = ${data.expectedDate || null}, note = ${data.note ?? ''}, updated_at = now()
        where id = ${id}
      `;
      return rowToPo(row);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan PO.' }, { status: 400 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'purchase-orders', entityId: id,
      entityLabel: `${before.poNumber} - ${data.supplierName!.trim()} - Rp${total}`,
      action: 'update', actor: guard, before,
      after: { ...before, supplierName: data.supplierName, items: poItems, total, note: data.note ?? '' },
    });
  } catch (err) {
    console.error('Failed to write history for PO update', err);
  }
  return Response.json({ ok: true });
}

// Hapus permanen hanya untuk PO draft yang belum punya GR apa pun. PO lain cukup dibatalkan.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  let before: ReturnType<typeof rowToPo>;
  try {
    before = await sql.begin(async pgTx => {
      const [row] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${id} for update`;
      if (!row) throw new Error('PO tidak ditemukan.');
      if (row.status !== 'draft') throw new Error('Hanya PO draft yang bisa dihapus. PO yang sudah dikirim cukup dibatalkan.');
      const [{ exists }] = await pgTx<{ exists: boolean }[]>`select exists(select 1 from goods_receipts where po_id = ${id}) as exists`;
      if (exists) throw new Error('PO ini sudah punya Penerimaan Barang (GR) — tidak bisa dihapus.');
      await pgTx`delete from purchase_orders where id = ${id}`;
      return rowToPo(row);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus PO.' }, { status: 400 });
  }
  try {
    await logHistory(getDb(), {
      entity: 'purchase-orders', entityId: id, entityLabel: `${before.poNumber} - ${before.supplierName}`,
      action: 'delete', actor: guard, before,
    });
  } catch (err) {
    console.error('Failed to write history for PO delete', err);
  }
  return Response.json({ ok: true });
}
