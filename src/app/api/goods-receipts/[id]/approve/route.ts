import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { createPurchaseTx } from '@/lib/material-purchase-core';
import { rowToGr, receivedByMaterial, buildGrItems, recalcPoStatus, type GrRow, type PoRow, type PoItem, type GrItem } from '@/lib/purchase-orders-pg';

type Ctx = { params: Promise<{ id: string }> };

// Approve GR — satu-satunya titik di mana barang PO masuk ke Pembelian: dalam SATU transaksi dibuat
// baris `material_purchases` (stok + harga rata-rata + pengeluaran kalau Lunas, lewat createPurchaseTx
// yang sama dengan Pembelian manual), GR ditandai approved, dan status PO dihitung ulang.
// Dompet & status bayar ditentukan di sini. Butuh aksi `approve` di menu Bahan Baku.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'approve');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { walletId?: string | null; paymentStatus?: 'lunas' | 'belum_lunas' };
  const walletId = body.walletId || null;
  if (!walletId) return Response.json({ error: 'Dompet sumber wajib dipilih.' }, { status: 400 });
  const paymentStatus = body.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';

  const sql = getSql();
  const purchaseId = randomUUID();
  const expenseId = randomUUID();
  let before: ReturnType<typeof rowToGr>;
  let purchaseData: Record<string, unknown> = {};
  let grNumber = '';
  try {
    before = await sql.begin(async pgTx => {
      const [probe] = await pgTx<{ po_id: string }[]>`select po_id from goods_receipts where id = ${id}`;
      if (!probe) throw new Error('GR tidak ditemukan.');
      // Urutan kunci: PO dulu, baru GR (sama dengan PUT GR & batal GR) — mencegah deadlock.
      const [po] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${probe.po_id} for update`;
      const [gr] = await pgTx<GrRow[]>`select * from goods_receipts where id = ${id} for update`;
      if (gr.status !== 'draft') throw new Error(gr.status === 'approved' ? 'GR ini sudah di-approve.' : 'GR ini sudah dibatalkan.');
      if (po.status === 'batal') throw new Error('PO sudah dibatalkan.');
      const [wallet] = await pgTx<{ id: string }[]>`select id from wallets where id = ${walletId}`;
      if (!wallet) throw new Error('Dompet tidak ditemukan.');

      // Validasi ulang terhadap sisa PO saat ini (bukan snapshot saat GR dibuat).
      const poItems = (parseJsonb(po.items as string | PoItem[] | null) as PoItem[] | null) ?? [];
      const grItems = (parseJsonb(gr.items as string | GrItem[] | null) as GrItem[] | null) ?? [];
      const items = buildGrItems(poItems, await receivedByMaterial(pgTx, po.id, gr.id), grItems);

      const doRef = gr.supplier_do_number ? ` / DO supplier ${gr.supplier_do_number}` : '';
      purchaseData = await createPurchaseTx(pgTx, {
        purchaseId, expenseId,
        supplierId: po.supplier_id,
        supplierName: po.supplier_name,
        items: items.map(it => ({ materialId: it.materialId, materialName: it.materialName, unit: it.unit, qty: it.qty, price: it.price })),
        date: gr.received_date,
        note: `Dari ${po.po_number} / ${gr.gr_number}${doRef}${gr.note ? ` — ${gr.note}` : ''}`,
        walletId, paymentStatus,
        poId: po.id, grId: gr.id,
      });
      const total = Number(purchaseData.total);
      await pgTx`
        update goods_receipts set
          status = 'approved', items = ${JSON.stringify(items)}, total = ${total},
          wallet_id = ${walletId}, payment_status = ${paymentStatus}, purchase_id = ${purchaseId},
          approved_by = ${guard.username}, approved_at = now(), updated_at = now()
        where id = ${id}
      `;
      await recalcPoStatus(pgTx, po.id);
      grNumber = gr.gr_number;
      return rowToGr(gr);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal meng-approve GR.' }, { status: 400 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'goods-receipts', entityId: id, entityLabel: `${grNumber} - Rp${purchaseData.total}`,
      action: 'update', actor: guard, before, after: { ...before, status: 'approved', purchaseId, walletId, paymentStatus },
      meta: { purchaseId },
    });
    await logHistory(getDb(), {
      entity: 'material-purchases', entityId: purchaseId,
      entityLabel: `${String(purchaseData.supplierName || 'Tanpa nama')} - Rp${purchaseData.total}`,
      action: 'create', actor: guard, after: purchaseData, meta: { grId: id },
    });
  } catch (err) {
    console.error('Failed to write history for GR approve', err);
  }
  revalidateTag('admin-materials', { expire: 0 });
  if (purchaseData.expenseId) revalidateTag('admin-expenses', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, purchaseId });
}
