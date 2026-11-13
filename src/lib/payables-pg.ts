import { getSql } from '@/lib/db';
import { buildPayableRow, type PayableRow } from '@/lib/payables-core';

// Hutang supplier aktif = pembelian tidak void, kolom payment_status 'belum_lunas', dan sisa > toleransi.
// Dipakai rute rekap (GET /api/material-purchases/payables) dan cron pengingat jatuh tempo.
export async function loadPayableRows(now = new Date()): Promise<PayableRow[]> {
  const sql = getSql();
  const rows = await sql<{
    id: string; supplier_id: string | null; supplier_name: string; po_number: string | null; gr_number: string | null;
    date: string; total: string; paid: string; due_date: string | null; wallet_id: string | null;
  }[]>`
    select p.id, p.supplier_id, p.supplier_name, po.po_number, gr.gr_number, p.date, p.total, p.due_date, p.wallet_id,
      coalesce((select sum(pp.amount) from material_purchase_payments pp where pp.purchase_id = p.id and not pp.voided), 0) as paid
    from material_purchases p
    left join purchase_orders po on po.id = p.po_id
    left join goods_receipts gr on gr.id = p.gr_id
    where not p.voided and p.payment_status = 'belum_lunas'
  `;
  return rows.flatMap(r => {
    const row = buildPayableRow({
      id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name ?? '', poNumber: r.po_number, grNumber: r.gr_number,
      date: r.date, total: Number(r.total), paid: Number(r.paid), dueDate: r.due_date, walletId: r.wallet_id,
    }, now);
    return row ? [row] : [];
  });
}
