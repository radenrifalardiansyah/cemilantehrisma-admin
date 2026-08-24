import { Firestore, Transaction } from 'firebase-admin/firestore';
import { readProductsForDeltas, applyStockDelta, writeStockLedgerEntry } from '@/lib/stock';

export interface RestorableOrderItem { productId?: string; name: string; qty: number; }
export interface RestorableOrder {
  items?: RestorableOrderItem[];
  source?: string;
  invoiceNo?: string;
  stockCut?: boolean;
  stockRestored?: boolean;
  warehouseId?: string;
  warehouseName?: string;
}

// Kembalikan stok satu pesanan yang stoknya sudah pernah dipotong. Dua sumber kebenaran:
// - `source === 'kasir'`: kasir SELALU memotong stok sejak dibuat (termasuk pesanan lama dari
//   sebelum flag `stockCut` ada — kalau digantung ke flag saja, pesanan lama tidak akan pernah
//   di-restore saat dibatalkan/dihapus).
// - `stockCut === true`: dipakai pesanan online, yang baru memotong stok begitu ditandai selesai
//   (lihat PUT /api/orders/[id]).
// No-op kalau belum pernah dipotong atau sudah pernah dikembalikan sebelumnya. Harus dipanggil di
// dalam transaksi milik caller (mis. digabung dengan `tx.update(status)` atau `tx.delete(orderRef)`)
// supaya restore + perubahan order jadi satu operasi atomik.
export async function restoreOrderStockInTx(tx: Transaction, db: Firestore, order: RestorableOrder): Promise<void> {
  const wasStockCut = order.source === 'kasir' || order.stockCut === true;
  if (!wasStockCut || order.stockRestored) return;
  const items = (order.items ?? []).filter(i => i.qty > 0);
  if (items.length === 0) return;

  // Item lama (sebelum productId ikut disimpan di tiap item order) dicocokkan lewat nama produk.
  // limit(2) (bukan 1) supaya bisa dideteksi kalau ada LEBIH DARI SATU produk dengan nama yang
  // sama persis (tidak ada constraint keunikan nama) — kalau ambigu, lebih aman melewati restore
  // item ini (perilaku lama untuk item yang sama sekali tidak ketemu) daripada menebak salah satu
  // dan mengembalikan stok ke produk yang keliru.
  const resolved = await Promise.all(items.map(async item => {
    if (item.productId) return item;
    const snap = await tx.get(db.collection('products').where('name', '==', item.name).limit(2));
    if (snap.size !== 1) return null;
    return { ...item, productId: snap.docs[0].id };
  }));

  const deltas = new Map<string, number>();
  for (const item of resolved) {
    if (!item?.productId) continue;
    deltas.set(item.productId, (deltas.get(item.productId) ?? 0) + item.qty);
  }
  if (deltas.size === 0) return;

  const { products } = await readProductsForDeltas(tx, db, deltas);
  for (const [productId, delta] of deltas) {
    const product = products.get(productId)!;
    applyStockDelta(tx, db, { productId, product, warehouseId: order.warehouseId, delta });
    writeStockLedgerEntry(tx, db, {
      productId, warehouseId: order.warehouseId, warehouseName: order.warehouseName,
      type: 'in', qty: delta,
      note: `Restore stok — pesanan ${order.invoiceNo ?? ''} dibatalkan/dihapus`,
    });
  }
}
