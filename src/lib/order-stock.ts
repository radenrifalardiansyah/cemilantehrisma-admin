import { getDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

interface RestorableOrderItem { productId?: string; name: string; qty: number; }
interface RestorableOrder {
  items?: RestorableOrderItem[];
  source?: string;
  invoiceNo?: string;
  stockRestored?: boolean;
}

// Kasir memotong stok saat transaksi dibuat (lihat PosTab.tsx) — pesanan Website ('portal')
// tidak pernah memotong stok, jadi tidak ada yang perlu dikembalikan untuknya.
// Item lama (sebelum productId ikut disimpan) dicocokkan lewat nama produk sebagai fallback.
export async function restoreOrderStock(order: RestorableOrder): Promise<void> {
  if (order.stockRestored || order.source !== 'kasir') return;
  const items = order.items ?? [];
  if (items.length === 0) return;

  const db = getDb();

  await Promise.all(items.map(async item => {
    if (!item.qty || item.qty <= 0) return;
    let productId = item.productId;
    if (!productId) {
      const snap = await db.collection('products').where('name', '==', item.name).limit(1).get();
      if (snap.empty) return;
      productId = snap.docs[0].id;
    }

    await db.collection('stock').add({
      productId,
      type: 'in',
      qty: item.qty,
      note: `Restore stok — pesanan ${order.invoiceNo ?? ''} dibatalkan/dihapus`,
      createdAt: FieldValue.serverTimestamp(),
    });

    const productRef = db.collection('products').doc(productId);
    await db.runTransaction(async tx => {
      const snap = await tx.get(productRef);
      if (!snap.exists) return;
      const product = snap.data();
      const currentQty = typeof product?.stockQty === 'number' ? product.stockQty as number : 0;
      const newQty = currentQty + item.qty;
      tx.update(productRef, {
        stockQty: newQty,
        stock: product?.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }));
}
