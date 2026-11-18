import type { TransactionSql } from 'postgres';
import { restoreOrderStockInTxPg, type RestorableOrderItem } from '@/lib/order-stock-pg';
import { voidStoreConsignSaleForOrder } from '@/lib/store-consign';
import type { rowToOrder } from '@/lib/orders-pg';

export function toRestorable(order: ReturnType<typeof rowToOrder>) {
  return {
    items: order.items as RestorableOrderItem[],
    source: order.source,
    invoiceNo: order.invoiceNo,
    stockCut: order.stockCut,
    stockRestored: order.stockRestored,
    warehouseId: order.warehouseId,
    warehouseName: order.warehouseName,
  };
}

/**
 * Efek samping pembatalan pesanan (status -> 'dibatalkan'), dijalankan DI DALAM transaksi milik caller yang sudah
 * mengunci baris order (`for update`): kembalikan stok yang sudah dipotong, batalkan penjualan titipan lapak,
 * kembalikan kuota voucher. Return kolom `orders` tambahan yang harus ikut di-update oleh caller.
 * Dipakai bersama oleh PUT /api/orders/[id] (admin) dan cron expire-unpaid-orders.
 */
export async function applyOrderCancellationInTx(
  pgTx: TransactionSql, order: ReturnType<typeof rowToOrder>, p: { orderId: string; username: string },
): Promise<Record<string, unknown>> {
  const cols: Record<string, unknown> = {};
  await restoreOrderStockInTxPg(pgTx, toRestorable(order));
  // Bagian titipan (penjualan lapak Toko) ikut dibatalkan.
  await voidStoreConsignSaleForOrder(pgTx, { orderId: p.orderId, username: p.username, reason: 'Pesanan dibatalkan' });
  // Kuota voucher yang dipakai pesanan ini dikembalikan (sekali — kode dikosongkan).
  if (order.voucherCode) {
    await pgTx`update vouchers set used_count = greatest(used_count - 1, 0) where code = ${order.voucherCode}`;
    cols.voucher_code = null;
  }
  cols.stock_restored = true;
  return cols;
}
