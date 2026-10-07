import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { invalidPurchaseItemMessage } from '@/lib/validate-items';
import { logHistory } from '@/lib/history';
import { createPoTx } from '@/lib/purchase-orders-core';
import { rowToPo, type PoRow, type GrItem } from '@/lib/purchase-orders-pg';
import { wibDateKey } from '@/lib/date';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [rows, grRows] = await Promise.all([
    sql<PoRow[]>`
      select po.*, cp.full_name as created_by_name, cp.signature as created_by_signature
      from purchase_orders po left join profiles cp on cp.username = po.created_by
      order by po.created_at desc
    `,
    sql<{ po_id: string; items: unknown }[]>`select po_id, items from goods_receipts where status = 'approved'`,
  ]);
  // Qty yang sudah diterima (GR approved) per PO per bahan — untuk progres di daftar PO.
  const receivedByPo = new Map<string, Record<string, number>>();
  for (const g of grRows) {
    const acc = receivedByPo.get(g.po_id) ?? {};
    for (const it of (parseJsonb(g.items as string | GrItem[] | null) as GrItem[] | null) ?? []) {
      acc[it.materialId] = (acc[it.materialId] ?? 0) + it.qty;
    }
    receivedByPo.set(g.po_id, acc);
  }
  return Response.json({
    purchaseOrders: rows.map(r => ({ ...rowToPo(r), received: receivedByPo.get(r.id) ?? {} })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
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

  const date = data.date || wibDateKey(new Date());
  const sql = getSql();
  let created: Awaited<ReturnType<typeof createPoTx>>;
  try {
    created = await sql.begin(pgTx => createPoTx(pgTx, {
      supplierId: data.supplierId ?? null, supplierName: data.supplierName!.trim(), supplierPhone: data.supplierPhone ?? '',
      date, expectedDate: data.expectedDate || null, note: data.note ?? '', items, createdBy: guard.username,
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membuat PO.' }, { status: 400 });
  }
  const { id, poNumber, total, poItems } = created;

  try {
    await logHistory(getDb(), {
      entity: 'purchase-orders', entityId: id,
      entityLabel: `${poNumber} - ${data.supplierName!.trim()} - Rp${total}`,
      action: 'create', actor: guard,
      after: { poNumber, supplierName: data.supplierName, items: poItems, total, date },
    });
  } catch (err) {
    console.error('Failed to write history for PO create', err);
  }
  return Response.json({ id, poNumber });
}
