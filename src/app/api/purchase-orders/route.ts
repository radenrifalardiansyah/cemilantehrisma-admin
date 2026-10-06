import { NextRequest } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { invalidPurchaseItemMessage } from '@/lib/validate-items';
import { logHistory } from '@/lib/history';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { rowToPo, type PoRow, type PoItem, type GrItem } from '@/lib/purchase-orders-pg';
import { wibDateKey } from '@/lib/date';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [rows, grRows] = await Promise.all([
    sql<PoRow[]>`select * from purchase_orders order by created_at desc`,
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
  const id = randomUUID();
  const token = randomBytes(16).toString('hex');
  const poItems: PoItem[] = items.map(it => ({ ...it, subtotal: it.qty * it.price }));
  const total = poItems.reduce((s, it) => s + it.subtotal, 0);

  let poNumber = '';
  try {
    await sql.begin(async pgTx => {
      const ids = [...new Set(items.map(it => it.materialId))];
      const found = await pgTx<{ id: string }[]>`select id from raw_materials where id in ${pgTx(ids)}`;
      if (found.length !== ids.length) throw new Error('Ada bahan baku yang tidak ditemukan.');

      // Nomor HP supplier diambil dari master supplier (disalin ke PO supaya tidak berubah kalau
      // master diedit kemudian); isian manual di form menang kalau ada.
      let phone = data.supplierPhone?.trim() ?? '';
      if (data.supplierId) {
        const [sup] = await pgTx<{ phone: string }[]>`select phone from suppliers where id = ${data.supplierId}`;
        if (!sup) throw new Error('Supplier tidak ditemukan.');
        if (!phone) phone = sup.phone ?? '';
      }
      poNumber = await nextDocNumber(pgTx, 'PO', periodOf(date));
      await pgTx`
        insert into purchase_orders (id, po_number, supplier_id, supplier_name, supplier_phone, items, total, date, expected_date, note, status, token, created_by, created_at)
        values (${id}, ${poNumber}, ${data.supplierId ?? null}, ${data.supplierName!.trim()}, ${phone}, ${JSON.stringify(poItems)}, ${total}, ${date}, ${data.expectedDate || null}, ${data.note ?? ''}, 'draft', ${token}, ${guard.username}, now())
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membuat PO.' }, { status: 400 });
  }

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
