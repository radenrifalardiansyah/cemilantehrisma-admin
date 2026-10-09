import { randomUUID } from 'crypto';
import type { TransactionSql } from 'postgres';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import type { ReceiptItem } from '@/lib/consign-pg';

// Semua fungsi di sini WAJIB dipanggil di dalam sql.begin() milik caller.

interface StockRow { id: string; product_id: string; stall_id: string; stock_qty: string }

export class ConsignStockError extends Error {}

// Ubah stok produk titipan di satu lapak. Baris stall_item dibuat otomatis kalau belum ada
// (khusus delta > 0) dan dikunci FOR UPDATE; stok tidak boleh negatif. Menulis ledger.
export async function moveConsignStock(
  tx: TransactionSql,
  opts: { productId: string; productName: string; stallId: string; stallName: string; delta: number; type: string; receiptId: string | null; note: string },
): Promise<number> {
  const { productId, productName, stallId, stallName, delta, type, receiptId, note } = opts;
  if (delta > 0) {
    await tx`
      insert into consign_stall_items (id, product_id, stall_id, stock_qty, created_at, updated_at)
      values (${randomUUID()}, ${productId}, ${stallId}, 0, now(), now())
      on conflict (product_id, stall_id) do nothing
    `;
  }
  const [row] = await tx<StockRow[]>`
    select id, product_id, stall_id, stock_qty from consign_stall_items
    where product_id = ${productId} and stall_id = ${stallId} for update
  `;
  const current = row ? Number(row.stock_qty) : 0;
  const next = current + delta;
  if (!row || next < 0) {
    throw new ConsignStockError(`${productName} di ${stallName}: stok tersisa ${current}, butuh ${-delta}.`);
  }
  await tx`update consign_stall_items set stock_qty = ${next}, updated_at = now() where id = ${row.id}`;
  await tx`
    insert into consign_stock_ledger (id, product_id, product_name, stall_id, stall_name, type, qty, balance_after, receipt_id, note, created_at)
    values (${randomUUID()}, ${productId}, ${productName}, ${stallId}, ${stallName}, ${type}, ${delta}, ${next}, ${receiptId}, ${note}, now())
  `;
  return next;
}

// Buat dokumen terima barang ('in') atau retur ke penitip ('return') + gerakkan stok.
export async function createReceipt(
  tx: TransactionSql,
  p: {
    kind: 'in' | 'return'; consignorId: string; consignorName: string; stallId: string; stallName: string;
    docDate: string; note: string; createdBy: string; items: ReceiptItem[];
  },
): Promise<{ id: string; docNumber: string }> {
  const id = randomUUID();
  const docNumber = await nextDocNumber(tx, p.kind === 'in' ? 'TJI' : 'TJR', periodOf(p.docDate));
  const totalQty = p.items.reduce((a, i) => a + i.qty, 0);
  // Urut per productId supaya urutan kunci baris konsisten antar request (hindari deadlock).
  const ordered = [...p.items].sort((a, b) => a.productId.localeCompare(b.productId));
  await tx`
    insert into consign_receipts (id, doc_number, kind, consignor_id, consignor_name, stall_id, stall_name, doc_date, items, total_qty, note, created_by, created_at)
    values (${id}, ${docNumber}, ${p.kind}, ${p.consignorId}, ${p.consignorName}, ${p.stallId}, ${p.stallName}, ${p.docDate},
      ${JSON.stringify(p.items)}::jsonb, ${totalQty}, ${p.note}, ${p.createdBy}, now())
  `;
  for (const i of ordered) {
    await moveConsignStock(tx, {
      productId: i.productId, productName: i.productName, stallId: p.stallId, stallName: p.stallName,
      delta: p.kind === 'in' ? i.qty : -i.qty, type: p.kind, receiptId: id, note: docNumber,
    });
  }
  return { id, docNumber };
}

// Batalkan dokumen: stok dibalik dan dokumen dihapus (jejak tetap ada di consign_stock_ledger
// sebagai pasangan 'in'/'return' + 'void'). Gagal kalau stok sudah terpakai (terjual) sehingga
// tidak cukup untuk dibalik.
export async function voidReceipt(
  tx: TransactionSql,
  r: { id: string; docNumber: string; kind: 'in' | 'return'; stallId: string; stallName: string; items: ReceiptItem[] },
): Promise<void> {
  const ordered = [...r.items].sort((a, b) => a.productId.localeCompare(b.productId));
  for (const i of ordered) {
    await moveConsignStock(tx, {
      productId: i.productId, productName: i.productName, stallId: r.stallId, stallName: r.stallName,
      delta: r.kind === 'in' ? -i.qty : i.qty, type: 'void', receiptId: r.id, note: `Batal ${r.docNumber}`,
    });
  }
  await tx`delete from consign_receipts where id = ${r.id}`;
}
