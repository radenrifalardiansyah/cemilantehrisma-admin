import { randomUUID } from 'crypto';
import type { TransactionSql } from 'postgres';
import type { getSql } from '@/lib/db';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';
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

interface LineRow { id: string; product_id: string; product_name: string; qty: string; consignor_amount: string; source: string }

// Baris bagi hasil yang BELUM direkap dan tidak dibatalkan untuk satu lapak × penitip dalam rentang
// tanggal WIB. `lock` = kunci baris (dipakai saat membuat rekap supaya dua rekap bersamaan tidak
// mengambil baris yang sama).
export async function loadUnsettledLines(
  tx: TransactionSql, p: { stallId: string; consignorId: string; from: string; to: string; lock?: boolean },
): Promise<{ ids: string[]; items: SettlementItem[]; total: number; count: number }> {
  const start = wibDayStart(p.from).toDate();
  const end = wibDayEnd(p.to).toDate();
  const rows = await tx<LineRow[]>`
    select l.id, l.product_id, l.product_name, l.qty, l.consignor_amount, l.source
    from consign_sale_lines l left join stall_sales s on s.id = l.sale_id
    where l.stall_id = ${p.stallId} and l.consignor_id = ${p.consignorId}
      and not l.voided and l.settlement_id is null and (l.sale_id is null or s.status = 'paid')
      and l.created_at >= ${start} and l.created_at <= ${end}
    order by l.product_name, l.id
    ${p.lock ? tx`for update of l` : tx``}
  `;
  // Penjualan dan kompensasi kerugian (barang rusak/hilang yang ditanggung toko) dipisah barisnya.
  const byProduct = new Map<string, SettlementItem>();
  for (const r of rows) {
    const loss = r.source === 'loss';
    const key = loss ? `${r.product_id}~loss` : r.product_id;
    const cur = byProduct.get(key) ?? { productId: key, productName: loss ? `${r.product_name} (kompensasi kerugian)` : r.product_name, qty: 0, amount: 0 };
    cur.qty += Number(r.qty); cur.amount += Number(r.consignor_amount);
    byProduct.set(key, cur);
  }
  const items = [...byProduct.values()];
  return { ids: rows.map(r => r.id), items, total: items.reduce((a, i) => a + i.amount, 0), count: rows.length };
}

// Buat dokumen rekap: semua baris bagi hasil yang belum direkap untuk lapak × penitip dalam periode
// dikunci ke dokumen ini (tidak bisa masuk rekap lain, dan penjualannya tidak bisa dibatalkan lagi).
// Dipakai admin (Titip Jual → Rekap & Bayar) dan kasir lapak (Kasir Lapak → Rekap). null = tidak ada
// penjualan yang belum direkap pada periode itu.
export async function createSettlementDoc(
  sql: ReturnType<typeof getSql>,
  p: { stall: { id: string; name: string }; consignor: { id: string; name: string }; from: string; to: string; note: string; createdBy: string },
): Promise<{ id: string; docNumber: string; total: number } | null> {
  return sql.begin(async tx => {
    const found = await loadUnsettledLines(tx, { stallId: p.stall.id, consignorId: p.consignor.id, from: p.from, to: p.to, lock: true });
    if (found.count === 0) return null;
    const id = randomUUID();
    const docNumber = await nextDocNumber(tx, 'TJB', periodOf(wibDateKey(new Date())));
    await tx`
      insert into consign_settlements (id, doc_number, stall_id, stall_name, consignor_id, consignor_name, period_from, period_to,
        total_amount, lines_count, items, status, note, created_by, created_at)
      values (${id}, ${docNumber}, ${p.stall.id}, ${p.stall.name}, ${p.consignor.id}, ${p.consignor.name}, ${p.from}, ${p.to},
        ${found.total}, ${found.count}, ${tx.json(found.items as never)}, 'unpaid', ${p.note.trim().slice(0, 200)}, ${p.createdBy}, now())
    `;
    await tx`update consign_sale_lines set settlement_id = ${id} where id in ${tx(found.ids)}`;
    return { id, docNumber, total: found.total };
  });
}
