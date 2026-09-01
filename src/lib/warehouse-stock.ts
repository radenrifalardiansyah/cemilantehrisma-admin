import { getSql } from '@/lib/db';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { revalidateStorefront } from '@/lib/revalidate';

// Kosongkan stok satu produk di satu gudang ke 0 — dipakai baik untuk clear per-produk
// maupun clear-semua-produk (dipanggil per produk dari daftar warehouse_stock gudang tsb).
// Mengurangi stockQty global produk sesuai qty yang benar-benar ada di gudang ini, dan
// mencatat entri 'out' di riwayat stok untuk audit trail. No-op kalau stok sudah 0.
async function clearWarehouseProductStockTx(warehouseId: string, productId: string, note: string): Promise<void> {
  const sql = getSql();
  await sql.begin(async pgTx => {
    const [wsRow] = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${`${warehouseId}_${productId}`} for update`;
    const currentQty = wsRow ? Number(wsRow.stock_qty) || 0 : 0;
    if (currentQty <= 0) return;

    const { products } = await readProductsForDeltasPg(pgTx, new Map([[productId, -currentQty]]));
    const product = products.get(productId)!;
    // Gudang tidak boleh menyeret total global di bawah 0 kalau datanya sudah kadung tidak sinkron —
    // clamp seperti perilaku lama, bukan re-throw shortage.
    const delta = -Math.min(currentQty, product.currentQty);

    await pgTx`update warehouse_stock set stock_qty = 0, updated_at = now() where id = ${`${warehouseId}_${productId}`}`;
    await applyStockDeltaPg(pgTx, { productId, product, delta });
    await writeStockLedgerEntryPg(pgTx, {
      productId, productName: product.name, warehouseId, type: 'out', qty: currentQty, note,
    });
  });
}

export async function clearWarehouseProductStock(warehouseId: string, productId: string, note: string): Promise<void> {
  await clearWarehouseProductStockTx(warehouseId, productId, note);
  await revalidateStorefront('products');
}

// Kosongkan stok BANYAK produk sekaligus di satu gudang (dipakai oleh "kosongkan semua stok" dan
// oleh penghapusan gudang). Diproses SATU PER SATU dan tidak pernah throw — satu error transient
// di tengah jalan tidak boleh membuat seluruh request gagal tanpa info produk mana yang sudah/belum
// ter-commit, padahal transaksi yang sudah commit tetap permanen (bukan rollback bersama).
// Pemanggil memutuskan sendiri apa yang dilakukan dengan daftar `failed` (mis. batalkan hapus
// gudang kalau ada yang gagal).
export async function clearWarehouseStockForProducts(
  warehouseId: string,
  productIds: string[],
  note: string,
): Promise<{ cleared: string[]; failed: { productId: string; error: string }[] }> {
  const cleared: string[] = [];
  const failed: { productId: string; error: string }[] = [];
  for (const productId of productIds) {
    try {
      await clearWarehouseProductStockTx(warehouseId, productId, note);
      cleared.push(productId);
    } catch (err) {
      failed.push({ productId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (cleared.length > 0) await revalidateStorefront('products');
  return { cleared, failed };
}
