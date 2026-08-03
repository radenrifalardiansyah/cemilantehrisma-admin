import { getDb } from '@/lib/firebase-admin';
import { FieldValue, Firestore } from 'firebase-admin/firestore';

// Kosongkan stok satu produk di satu gudang ke 0 — dipakai baik untuk clear per-produk
// maupun clear-semua-produk (dipanggil per produk dari daftar warehouse_stock gudang tsb).
// Mengurangi stockQty global produk sesuai qty yang benar-benar ada di gudang ini, dan
// mencatat entri 'out' di riwayat stok untuk audit trail. No-op kalau stok sudah 0.
export async function clearWarehouseProductStock(warehouseId: string, productId: string, note: string): Promise<void> {
  const db: Firestore = getDb();
  const wsRef = db.collection('warehouse_stock').doc(`${warehouseId}_${productId}`);
  const productRef = db.collection('products').doc(productId);
  const stockRef = db.collection('stock').doc();

  await db.runTransaction(async tx => {
    const [wsSnap, productSnap] = await Promise.all([tx.get(wsRef), tx.get(productRef)]);
    const currentQty = typeof wsSnap.data()?.stockQty === 'number' ? wsSnap.data()!.stockQty as number : 0;
    if (currentQty <= 0) return;

    const product = productSnap.data();
    const productQty = typeof product?.stockQty === 'number' ? product.stockQty as number : 0;
    const newProductQty = Math.max(0, productQty - currentQty);

    tx.set(wsRef, { stockQty: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    if (productSnap.exists) {
      tx.update(productRef, {
        stockQty: newProductQty,
        stock: product?.openPO ? 'open_po' : newProductQty > 0 ? 'ready' : 'habis',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(stockRef, {
      warehouseId,
      productId,
      productName: product?.name ?? '',
      type: 'out',
      qty: currentQty,
      note,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}
