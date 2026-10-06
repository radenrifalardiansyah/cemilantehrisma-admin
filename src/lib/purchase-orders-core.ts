import { randomUUID, randomBytes } from 'crypto';
import { nextDocNumber, periodOf, type PgTx } from '@/lib/doc-number';
import type { PoItem } from '@/lib/purchase-orders-pg';

export interface CreatePoArgs {
  supplierId: string | null;
  supplierName: string;
  supplierPhone: string;
  date: string;
  expectedDate: string | null;
  note: string;
  items: { materialId: string; materialName: string; unit: string; qty: number; price: number }[];
  createdBy: string;
}

// Buat satu PO draft di dalam transaksi `pgTx` milik pemanggil — dipakai bersama oleh POST
// /api/purchase-orders dan impor Excel. Nomor HP supplier diambil dari master supplier (disalin ke
// PO supaya tidak berubah kalau master diedit kemudian); isian manual menang kalau ada.
export async function createPoTx(pgTx: PgTx, a: CreatePoArgs) {
  const ids = [...new Set(a.items.map(it => it.materialId))];
  const found = await pgTx<{ id: string }[]>`select id from raw_materials where id in ${pgTx(ids)}`;
  if (found.length !== ids.length) throw new Error('Ada bahan baku yang tidak ditemukan.');

  let phone = a.supplierPhone.trim();
  if (a.supplierId) {
    const [sup] = await pgTx<{ phone: string }[]>`select phone from suppliers where id = ${a.supplierId}`;
    if (!sup) throw new Error('Supplier tidak ditemukan.');
    if (!phone) phone = sup.phone ?? '';
  }
  const id = randomUUID();
  const token = randomBytes(16).toString('hex');
  const poItems: PoItem[] = a.items.map(it => ({ ...it, subtotal: it.qty * it.price }));
  const total = poItems.reduce((s, it) => s + it.subtotal, 0);
  const poNumber = await nextDocNumber(pgTx, 'PO', periodOf(a.date));
  await pgTx`
    insert into purchase_orders (id, po_number, supplier_id, supplier_name, supplier_phone, items, total, date, expected_date, note, status, token, created_by, created_at)
    values (${id}, ${poNumber}, ${a.supplierId}, ${a.supplierName}, ${phone}, ${JSON.stringify(poItems)}, ${total}, ${a.date}, ${a.expectedDate}, ${a.note}, 'draft', ${token}, ${a.createdBy}, now())
  `;
  return { id, poNumber, total, poItems };
}
