import { getDb } from '@/lib/firebase-admin';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { readProductsForDeltas, applyStockDelta, writeStockLedgerEntry } from '@/lib/stock';

// Kosongkan stok satu produk di satu gudang ke 0 — dipakai baik untuk clear per-produk
// maupun clear-semua-produk (dipanggil per produk dari daftar warehouse_stock gudang tsb).
// Mengurangi stockQty global produk sesuai qty yang benar-benar ada di gudang ini, dan
// mencatat entri 'out' di riwayat stok untuk audit trail. No-op kalau stok sudah 0.
export async function clearWarehouseProductStock(warehouseId: string, productId: string, note: string): Promise<void> {
  const db: Firestore = getDb();
  const wsRef = db.collection('warehouse_stock').doc(`${warehouseId}_${productId}`);

  await db.runTransaction(async tx => {
    const wsSnap = await tx.get(wsRef);
    const currentQty = typeof wsSnap.data()?.stockQty === 'number' ? wsSnap.data()!.stockQty as number : 0;
    if (currentQty <= 0) return;

    const { products } = await readProductsForDeltas(tx, db, new Map([[productId, -currentQty]]));
    const product = products.get(productId)!;
    // Gudang tidak boleh menyeret total global di bawah 0 kalau datanya sudah kadung tidak sinkron —
    // clamp seperti perilaku lama, bukan re-throw shortage.
    const delta = -Math.min(currentQty, product.currentQty);

    tx.set(wsRef, { stockQty: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    applyStockDelta(tx, db, { productId, product, delta });
    writeStockLedgerEntry(tx, db, {
      productId, warehouseId, type: 'out', qty: currentQty, note,
      extra: { productName: product.data.name ?? '' },
    });
  });
}
