import type { TransactionSql } from 'postgres';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { toTimestamp } from '@/lib/orders-pg';
import { parseJsonb } from '@/lib/db';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SettlementItem { productId: string; productName: string; qty: number; amount: number }

export interface SettlementRow {
  id: string; doc_number: string; stall_id: string; stall_name: string; consignor_id: string; consignor_name: string;
  period_from: string; period_to: string; total_amount: string; lines_count: number; items: unknown; status: 'unpaid' | 'paid';
  note: string; created_by: string | null; created_at: Date; paid_at: Date | null; paid_by: string | null;
}
export function rowToSettlement(r: SettlementRow) {
  return {
    id: r.id, docNumber: r.doc_number, stallId: r.stall_id, stallName: r.stall_name, consignorId: r.consignor_id, consignorName: r.consignor_name,
    periodFrom: r.period_from, periodTo: r.period_to, totalAmount: Number(r.total_amount), linesCount: r.lines_count,
    items: parseJsonb<SettlementItem[]>(r.items as SettlementItem[] | string | null) ?? [], status: r.status, note: r.note,
    createdBy: r.created_by ?? '', createdAt: toTimestamp(r.created_at), paidAt: toTimestamp(r.paid_at), paidBy: r.paid_by ?? '',
  };
}

interface LineRow { id: string; product_id: string; product_name: string; qty: string; consignor_amount: string }

// Baris bagi hasil yang BELUM direkap dan tidak dibatalkan untuk satu lapak × penitip dalam rentang
// tanggal WIB. `lock` = kunci baris (dipakai saat membuat rekap supaya dua rekap bersamaan tidak
// mengambil baris yang sama).
export async function loadUnsettledLines(
  tx: TransactionSql, p: { stallId: string; consignorId: string; from: string; to: string; lock?: boolean },
): Promise<{ ids: string[]; items: SettlementItem[]; total: number; count: number }> {
  const start = wibDayStart(p.from).toDate();
  const end = wibDayEnd(p.to).toDate();
  const rows = await tx<LineRow[]>`
    select l.id, l.product_id, l.product_name, l.qty, l.consignor_amount
    from consign_sale_lines l join stall_sales s on s.id = l.sale_id
    where l.stall_id = ${p.stallId} and l.consignor_id = ${p.consignorId}
      and not l.voided and l.settlement_id is null and s.status = 'paid'
      and l.created_at >= ${start} and l.created_at <= ${end}
    order by l.product_name, l.id
    ${p.lock ? tx`for update of l` : tx``}
  `;
  const byProduct = new Map<string, SettlementItem>();
  for (const r of rows) {
    const cur = byProduct.get(r.product_id) ?? { productId: r.product_id, productName: r.product_name, qty: 0, amount: 0 };
    cur.qty += Number(r.qty); cur.amount += Number(r.consignor_amount);
    byProduct.set(r.product_id, cur);
  }
  const items = [...byProduct.values()];
  return { ids: rows.map(r => r.id), items, total: items.reduce((a, i) => a + i.amount, 0), count: rows.length };
}
