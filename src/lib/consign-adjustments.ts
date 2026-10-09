import { randomUUID } from 'crypto';
import type { TransactionSql } from 'postgres';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { moveConsignStock, ConsignStockError } from '@/lib/consign-receipts';
import { pricingFromRow, type ConsignPricingRow } from '@/lib/stall-pos-server';
import { parseJsonb } from '@/lib/db';
import { toTimestamp } from '@/lib/orders-pg';

// Stok opname & penyesuaian stok titipan. Semua fungsi WAJIB dipanggil di dalam sql.begin().
//  - opname: hitungan fisik per produk → selisih (bisa minus/plus) terhadap stok sistem.
//  - damage/lost/expired/other: pengurangan stok (rusak, hilang, kadaluarsa, lainnya).
// Kerugian (selisih minus) bisa DITANGGUNG toko atau penitip:
//  - toko    → toko tetap berutang bagian penitip untuk barang itu: dicatat sebagai baris 'loss'
//              (kompensasi) di consign_sale_lines yang ikut rekap & mengurangi bagian toko.
//  - penitip → tidak ada pengaruh ke uang (barang rusak/hilang jadi risiko penitip).
// Selisih plus (barang ditemukan lebih) hanya menambah stok, tanpa pengaruh uang.

export type AdjustmentKind = 'opname' | 'damage' | 'lost' | 'expired' | 'other';
export type Bearer = 'toko' | 'penitip' | 'none';
export const ADJUSTMENT_KINDS: AdjustmentKind[] = ['opname', 'damage', 'lost', 'expired', 'other'];

export interface AdjustmentItem {
  productId: string; productName: string; unit: string; consignorId: string; consignorName: string;
  before: number; after: number; delta: number; unitShare: number | null; compensation: number;
}

export interface AdjustmentRow {
  id: string; doc_number: string; kind: AdjustmentKind; stall_id: string; stall_name: string; bearer: Bearer; doc_date: string;
  items: unknown; total_delta: string; total_compensation: string; note: string; created_by: string | null; created_at: Date;
}
export function rowToAdjustment(r: AdjustmentRow) {
  return {
    id: r.id, docNumber: r.doc_number, kind: r.kind, stallId: r.stall_id, stallName: r.stall_name, bearer: r.bearer, docDate: r.doc_date,
    items: parseJsonb<AdjustmentItem[]>(r.items as AdjustmentItem[] | string | null) ?? [],
    totalDelta: Number(r.total_delta), totalCompensation: Number(r.total_compensation), note: r.note,
    createdBy: r.created_by ?? '', createdAt: toTimestamp(r.created_at),
  };
}

interface LockedRow extends ConsignPricingRow { stock_qty: string }

export async function createAdjustment(
  tx: TransactionSql,
  p: {
    kind: AdjustmentKind; stall: { id: string; name: string }; bearer: Bearer; docDate: string; note: string; createdBy: string;
    items: { productId: string; counted?: number; qty?: number }[];
  },
): Promise<{ id: string; docNumber: string; totalCompensation: number }> {
  const id = randomUUID();
  const docNumber = await nextDocNumber(tx, 'TJA', periodOf(p.docDate));
  const ordered = [...p.items].sort((a, b) => a.productId.localeCompare(b.productId));
  const result: AdjustmentItem[] = [];
  const lossLines: { item: AdjustmentItem; price: number; scheme: string; schemeValue: number }[] = [];

  for (const it of ordered) {
    const [r] = await tx<LockedRow[]>`
      select si.product_id, p.name, p.code, p.unit, p.default_price, p.scheme as p_scheme, p.scheme_value as p_value,
             si.price as si_price, si.scheme as si_scheme, si.scheme_value as si_value, si.stock_qty,
             c.id as consignor_id, c.name as consignor_name, c.scheme as c_scheme, c.scheme_value as c_value
      from consign_stall_items si
      join consign_products p on p.id = si.product_id
      join consignors c on c.id = p.consignor_id
      where si.stall_id = ${p.stall.id} and si.product_id = ${it.productId}
      for update of si
    `;
    if (!r) throw new ConsignStockError('Ada produk yang belum terdaftar di lapak ini.');
    const before = Number(r.stock_qty);
    let after: number;
    if (p.kind === 'opname') {
      if (it.counted === undefined || !Number.isFinite(it.counted) || it.counted < 0) throw new ConsignStockError(`${r.name}: hitungan fisik tidak valid.`);
      after = it.counted;
    } else {
      if (it.qty === undefined || !Number.isFinite(it.qty) || it.qty <= 0) throw new ConsignStockError(`${r.name}: jumlah harus lebih dari 0.`);
      if (it.qty > before) throw new ConsignStockError(`${r.name} di ${p.stall.name}: stok tersisa ${before}, tidak bisa dikurangi ${it.qty}.`);
      after = before - it.qty;
    }
    const delta = after - before;
    if (delta === 0) continue;

    let unitShare: number | null = null;
    let compensation = 0;
    if (delta < 0 && p.bearer === 'toko') {
      const pricing = pricingFromRow(r);
      if (!pricing.spec || !pricing.share) throw new ConsignStockError(`${r.name}: skema bagi hasil belum ditentukan — kompensasi tidak bisa dihitung.`);
      unitShare = pricing.share.consignor;
      compensation = -delta * unitShare;
      const item: AdjustmentItem = { productId: it.productId, productName: r.name, unit: r.unit, consignorId: r.consignor_id, consignorName: r.consignor_name, before, after, delta, unitShare, compensation };
      result.push(item);
      lossLines.push({ item, price: pricing.price, scheme: pricing.spec.scheme, schemeValue: pricing.spec.value });
    } else {
      result.push({ productId: it.productId, productName: r.name, unit: r.unit, consignorId: r.consignor_id, consignorName: r.consignor_name, before, after, delta, unitShare, compensation });
    }
    await moveConsignStock(tx, {
      productId: it.productId, productName: r.name, stallId: p.stall.id, stallName: p.stall.name,
      delta, type: `adjust_${p.kind}`, receiptId: id, note: docNumber,
    });
  }
  if (result.length === 0) throw new ConsignStockError('Tidak ada selisih stok — tidak ada yang perlu dicatat.');

  const totalDelta = result.reduce((a, i) => a + i.delta, 0);
  const totalCompensation = result.reduce((a, i) => a + i.compensation, 0);
  const hasLoss = result.some(i => i.delta < 0);
  await tx`
    insert into consign_adjustments (id, doc_number, kind, stall_id, stall_name, bearer, doc_date, items, total_delta, total_compensation, note, created_by, created_at)
    values (${id}, ${docNumber}, ${p.kind}, ${p.stall.id}, ${p.stall.name}, ${hasLoss ? p.bearer : 'none'}, ${p.docDate}, ${tx.json(result as never)},
      ${totalDelta}, ${totalCompensation}, ${p.note}, ${p.createdBy}, now())
  `;
  for (const l of lossLines) {
    await tx`
      insert into consign_sale_lines (id, sale_id, stall_id, consignor_id, consignor_name, product_id, product_name, qty, price, scheme, scheme_value,
        consignor_amount, our_amount, source, adjustment_id, created_at)
      values (${randomUUID()}, null, ${p.stall.id}, ${l.item.consignorId}, ${l.item.consignorName}, ${l.item.productId}, ${l.item.productName}, ${-l.item.delta},
        ${l.price}, ${l.scheme}, ${l.schemeValue}, ${l.item.compensation}, ${-l.item.compensation}, 'loss', ${id}, now())
    `;
  }
  return { id, docNumber, totalCompensation };
}

// Batalkan penyesuaian: stok dikembalikan ke kondisi sebelumnya dan baris kompensasi dihapus. Ditolak
// kalau kompensasinya sudah masuk rekap (batalkan rekapnya dulu) atau stok sekarang tidak cukup untuk
// membalik selisih plus.
export async function voidAdjustment(tx: TransactionSql, a: ReturnType<typeof rowToAdjustment>): Promise<void> {
  const [settled] = await tx`select 1 from consign_sale_lines where adjustment_id = ${a.id} and settlement_id is not null limit 1`;
  if (settled) throw new ConsignStockError('Kompensasi kerugian dokumen ini sudah masuk rekap — batalkan rekapnya dulu.');
  const ordered = [...a.items].sort((x, y) => x.productId.localeCompare(y.productId));
  for (const i of ordered) {
    await moveConsignStock(tx, {
      productId: i.productId, productName: i.productName, stallId: a.stallId, stallName: a.stallName,
      delta: -i.delta, type: 'void', receiptId: a.id, note: `Batal ${a.docNumber}`,
    });
  }
  await tx`delete from consign_sale_lines where adjustment_id = ${a.id}`;
  await tx`delete from consign_adjustments where id = ${a.id}`;
}
