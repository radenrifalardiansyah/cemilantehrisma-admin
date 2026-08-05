import { FieldValue, Firestore, Transaction, DocumentReference, DocumentData } from 'firebase-admin/firestore';

// Satu-satunya tempat yang boleh mengubah stok produk. Semua penulis stok (kasir, pesanan
// online, stok masuk/keluar manual, transfer gudang, konsinyasi, produksi, restore saat
// batal/hapus pesanan) wajib lewat sini supaya `products.stockQty` (dibaca kasir/toko
// online/dashboard) dan `warehouse_stock` (dibaca tab Stok per-gudang) tidak pernah berbeda.
// Fungsi-fungsi di sini beroperasi di dalam transaksi milik caller — tidak membuka transaksi
// sendiri — supaya bisa digabung dengan penulisan dokumen lain (order, dsb) secara atomik.

export interface ProductStockInfo {
  ref: DocumentReference<DocumentData>;
  data: DocumentData;
  currentQty: number;
  exists: boolean;
}

// Baca semua produk yang terkena delta sekaligus (harus dipanggil sebelum tx.get lain di
// dalam transaksi yang sama), dan validasi stok cukup untuk delta negatif (stok keluar).
// `shortages` berisi pesan human-readable siap ditampilkan ke user; kalau tidak kosong,
// caller harus batalkan (throw) transaksi tanpa menulis apa pun.
export async function readProductsForDeltas(
  tx: Transaction,
  db: Firestore,
  deltas: Map<string, number>,
): Promise<{ products: Map<string, ProductStockInfo>; shortages: string[] }> {
  const productIds = [...deltas.keys()];
  const refs = productIds.map(pid => db.collection('products').doc(pid));
  const snaps = await Promise.all(refs.map(r => tx.get(r)));

  const products = new Map<string, ProductStockInfo>();
  const shortages: string[] = [];

  productIds.forEach((pid, i) => {
    const snap = snaps[i];
    const data = snap.data() ?? {};
    const currentQty = typeof data.stockQty === 'number' ? data.stockQty as number : 0;
    const delta = deltas.get(pid)!;

    if (delta < 0 && (!snap.exists || currentQty < -delta)) {
      const name = typeof data.name === 'string' ? data.name : pid;
      shortages.push(`${name} (stok tersisa ${currentQty}, butuh ${-delta})`);
    }

    products.set(pid, { ref: refs[i], data, currentQty, exists: snap.exists });
  });

  return { products, shortages };
}

// Terapkan satu delta stok: update total global di `products`, ikut sesuaikan `warehouse_stock`
// kalau warehouseId dikirim. `product` harus hasil `readProductsForDeltas` di transaksi yang sama
// (tidak melakukan tx.get sendiri, supaya aman dipanggil setelah tx.get/tx.set lain di transaksi ini).
// Tidak menulis ledger — pakai `writeStockLedgerEntry` di samping ini kalau perlu tercatat di riwayat.
export function applyStockDelta(
  tx: Transaction,
  db: Firestore,
  opts: {
    productId: string;
    product: ProductStockInfo;
    warehouseId?: string;
    delta: number;
  },
): void {
  const { productId, product, warehouseId, delta } = opts;
  const newQty = product.currentQty + delta;

  // Skip kalau produknya sendiri sudah terhapus (mis. stray warehouse_stock/order yang masih
  // menunjuk productId lama) — tidak ada yang perlu di-update, jangan bikin dokumen produk baru.
  if (product.exists) {
    tx.update(product.ref, {
      stockQty: newQty,
      stock: product.data.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  if (warehouseId) {
    const wsRef = db.collection('warehouse_stock').doc(`${warehouseId}_${productId}`);
    tx.set(wsRef, {
      warehouseId, productId, productName: product.data.name ?? '',
      stockQty: FieldValue.increment(delta), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

// Catat satu entri riwayat stok (audit trail) di koleksi `stock`. Dipisah dari `applyStockDelta`
// supaya caller yang butuh field tambahan (mis. `date` dari form kasir) bisa menyisipkannya lewat `extra`.
export function writeStockLedgerEntry(
  tx: Transaction,
  db: Firestore,
  opts: {
    productId: string;
    warehouseId?: string;
    warehouseName?: string;
    type: 'in' | 'out' | 'adjustment' | 'transfer';
    qty: number;
    note: string;
    extra?: Record<string, unknown>;
  },
): void {
  const { productId, warehouseId, warehouseName, type, qty, note, extra } = opts;
  const stockRef = db.collection('stock').doc();
  tx.set(stockRef, {
    productId,
    ...(warehouseId ? { warehouseId, warehouseName: warehouseName ?? '' } : {}),
    ...extra,
    type,
    qty: Math.abs(qty),
    note,
    createdAt: FieldValue.serverTimestamp(),
  });
}
