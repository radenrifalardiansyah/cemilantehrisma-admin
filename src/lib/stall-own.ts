import { randomUUID } from 'crypto';
import type { TransactionSql } from 'postgres';
import { parseJsonb } from '@/lib/db';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';
import { toTimestamp } from '@/lib/orders-pg';
import { writeTransferLedgerEntryPg } from '@/lib/stock-pg';

// Produk toko di lapak: toko "menitipkan" produknya ke lapak (Kirim ke Lapak), lapak menjualnya di Kasir
// Lapak dengan harga khusus lapak, lalu menyetor hasilnya ke toko lewat rekap (jadi Pemasukan toko).

type Tx = TransactionSql;

export class OwnError extends Error {}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Harga jual produk toko di suatu lapak: harga khusus lapak, kalau belum diatur ikut harga toko.
export async function ownPriceMap(tx: Tx, stallId: string, productIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (productIds.length === 0) return out;
  const base = await tx<{ id: string; price: string | null }[]>`select id, price from products where id in ${tx(productIds)}`;
  for (const r of base) out.set(r.id, Number(r.price ?? 0));
  const over = await tx<{ product_id: string; price: string }[]>`select product_id, price from stall_product_prices where stall_id = ${stallId} and product_id in ${tx(productIds)}`;
  for (const r of over) out.set(r.product_id, Number(r.price));
  return out;
}

export interface ShipmentItem { productId: string; name: string; qty: number; price: number }

// Pindahkan stok antar gudang (produk toko), memakai kunci baris seragam (urut id) seperti API Transfer.
// fromId/toId boleh null = tidak menggerakkan stok (dokumen Saldo Awal).
export async function moveWarehouseStock(
  tx: Tx, p: { fromId: string; fromName: string; toId: string; toName: string; items: { productId: string; name: string; qty: number }[]; note: string },
): Promise<void> {
  const items = [...p.items].sort((a, b) => a.productId.localeCompare(b.productId));
  if (items.length === 0) return;
  const ids = items.flatMap(i => [`${p.fromId}_${i.productId}`, `${p.toId}_${i.productId}`]).sort();
  await tx`select id from warehouse_stock where id in ${tx(ids)} order by id for update`;
  for (const i of items) {
    const [row] = await tx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${`${p.fromId}_${i.productId}`}`;
    const have = row ? Number(row.stock_qty) || 0 : 0;
    if (have < i.qty) throw new OwnError(`Stok ${i.name} di ${p.fromName} tidak cukup (tersisa ${have}, butuh ${i.qty}).`);
    await tx`
      insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
      values (${`${p.fromId}_${i.productId}`}, ${p.fromId}, ${i.productId}, ${i.name}, ${-i.qty}, now())
      on conflict (id) do update set stock_qty = warehouse_stock.stock_qty - ${i.qty}, updated_at = now()
    `;
    await tx`
      insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
      values (${`${p.toId}_${i.productId}`}, ${p.toId}, ${i.productId}, ${i.name}, ${i.qty}, now())
      on conflict (id) do update set stock_qty = warehouse_stock.stock_qty + ${i.qty}, updated_at = now()
    `;
    await writeTransferLedgerEntryPg(tx, {
      productId: i.productId, productName: i.name, fromWarehouseId: p.fromId, fromWarehouseName: p.fromName,
      toWarehouseId: p.toId, toWarehouseName: p.toName, qty: i.qty, note: p.note,
    });
  }
}

export interface ShipmentRow {
  id: string; doc_number: string; kind: 'send' | 'return' | 'opening'; stall_id: string; stall_name: string;
  from_warehouse_id: string | null; from_warehouse_name: string; doc_date: string; items: unknown;
  total_qty: string; total_value: string; note: string; status: 'active' | 'void';
  created_by: string | null; created_at: Date; voided_by: string | null; voided_at: Date | null;
}
export function rowToShipment(r: ShipmentRow) {
  return {
    id: r.id, docNumber: r.doc_number, kind: r.kind, stallId: r.stall_id, stallName: r.stall_name,
    fromWarehouseId: r.from_warehouse_id ?? '', fromWarehouseName: r.from_warehouse_name, docDate: r.doc_date,
    items: parseJsonb<ShipmentItem[]>(r.items as ShipmentItem[] | string | null) ?? [],
    totalQty: Number(r.total_qty), totalValue: Number(r.total_value), note: r.note, status: r.status,
    createdBy: r.created_by ?? '', createdAt: toTimestamp(r.created_at), voidedBy: r.voided_by ?? '', voidedAt: toTimestamp(r.voided_at),
  };
}

export interface OwnSettlementItem { productId: string; productName: string; qty: number; amount: number }
export interface OwnSettlementRow {
  id: string; doc_number: string; stall_id: string; stall_name: string; period_from: string; period_to: string;
  total_amount: string; lines_count: number; items: unknown; status: 'unpaid' | 'paid'; note: string;
  wallet_id: string | null; income_id: string | null; created_by: string | null; created_at: Date; paid_at: Date | null; paid_by: string | null;
}
export function rowToOwnSettlement(r: OwnSettlementRow) {
  return {
    id: r.id, docNumber: r.doc_number, stallId: r.stall_id, stallName: r.stall_name, periodFrom: r.period_from, periodTo: r.period_to,
    totalAmount: Number(r.total_amount), linesCount: r.lines_count,
    items: parseJsonb<OwnSettlementItem[]>(r.items as OwnSettlementItem[] | string | null) ?? [],
    status: r.status, note: r.note, walletId: r.wallet_id ?? '', createdBy: r.created_by ?? '',
    createdAt: toTimestamp(r.created_at), paidAt: toTimestamp(r.paid_at), paidBy: r.paid_by ?? '',
  };
}

interface LineRow { id: string; product_id: string; product_name: string; qty: string; amount: string }

// Baris penjualan produk toko yang BELUM direkap dan tidak dibatalkan untuk satu lapak dalam rentang tanggal WIB.
export async function loadUnsettledOwnLines(
  tx: Tx, p: { stallId: string; from: string; to: string; lock?: boolean },
): Promise<{ ids: string[]; items: OwnSettlementItem[]; total: number; count: number }> {
  const rows = await tx<LineRow[]>`
    select l.id, l.product_id, l.product_name, l.qty, l.amount
    from stall_own_lines l join stall_sales s on s.id = l.sale_id
    where l.stall_id = ${p.stallId} and not l.voided and l.settlement_id is null and s.status = 'paid'
      and l.created_at >= ${wibDayStart(p.from).toDate()} and l.created_at <= ${wibDayEnd(p.to).toDate()}
    order by l.product_name, l.id
    ${p.lock ? tx`for update of l` : tx``}
  `;
  const by = new Map<string, OwnSettlementItem>();
  for (const r of rows) {
    const cur = by.get(r.product_id) ?? { productId: r.product_id, productName: r.product_name, qty: 0, amount: 0 };
    cur.qty += Number(r.qty); cur.amount += Number(r.amount);
    by.set(r.product_id, cur);
  }
  const items = [...by.values()];
  return { ids: rows.map(r => r.id), items, total: items.reduce((a, i) => a + i.amount, 0), count: rows.length };
}

// Kunci semua penjualan produk toko yang belum direkap (lapak × periode) ke satu dokumen setoran.
export async function createOwnSettlementDoc(
  tx: Tx, p: { stall: { id: string; name: string }; from: string; to: string; note: string; createdBy: string },
): Promise<{ id: string; docNumber: string; total: number } | null> {
  const found = await loadUnsettledOwnLines(tx, { stallId: p.stall.id, from: p.from, to: p.to, lock: true });
  if (found.count === 0) return null;
  const id = randomUUID();
  const docNumber = await nextDocNumber(tx, 'STP', periodOf(wibDateKey(new Date())));
  await tx`
    insert into stall_own_settlements (id, doc_number, stall_id, stall_name, period_from, period_to, total_amount, lines_count, items, status, note, created_by, created_at)
    values (${id}, ${docNumber}, ${p.stall.id}, ${p.stall.name}, ${p.from}, ${p.to}, ${found.total}, ${found.count}, ${tx.json(found.items as never)}, 'unpaid', ${p.note.trim().slice(0, 200)}, ${p.createdBy}, now())
  `;
  await tx`update stall_own_lines set settlement_id = ${id} where id in ${tx(found.ids)}`;
  return { id, docNumber, total: found.total };
}
