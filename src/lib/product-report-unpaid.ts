// Bagian penjualan di Laporan Produk yang SUDAH tercatat (direkap / pesanan sudah diproses) tetapi BELUM terbayar.
// Laporan Produk hanya menghitung porsi yang sudah dibayar (paidFraction) sebagai penjualan; porsi sisanya dijumlahkan
// di sini supaya kelihatan berapa piutang yang masih menggantung. Murni (tanpa DB) supaya bisa diuji.

export interface UnpaidOrderInput {
  status?: string; isFree?: boolean; paidFraction: number; total?: number;
  items?: { productId?: string; qty: number; price?: number; subtotal?: number }[];
}
export interface UnpaidRecapInput {
  paidFraction: number;
  items?: { qtySold: number; revenue?: number; hargaTitip?: number }[];
}
export interface UnpaidSummary {
  recapCount: number; recapQty: number; recapRevenue: number;
  orderCount: number; orderQty: number; orderRevenue: number;
  qty: number; revenue: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function computeUnpaid(orders: UnpaidOrderInput[], recaps: UnpaidRecapInput[]): UnpaidSummary {
  let recapCount = 0, recapQty = 0, recapRevenue = 0;
  for (const rec of recaps) {
    const u = 1 - clamp01(rec.paidFraction);
    if (u <= 0) continue;
    const items = rec.items ?? [];
    const rev = items.reduce((s, it) => s + (it.revenue ?? (it.hargaTitip ?? 0) * it.qtySold), 0);
    const qty = items.reduce((s, it) => s + it.qtySold, 0);
    if (qty <= 0 && rev <= 0) continue;
    recapCount++; recapQty += qty * u; recapRevenue += rev * u;
  }

  let orderCount = 0, orderQty = 0, orderRevenue = 0;
  for (const o of orders) {
    // Sama seperti penjualan yang dihitung: pesanan baru/dibatalkan belum dianggap tercatat; barang gratis bukan piutang.
    if (o.status === 'baru' || o.status === 'dibatalkan' || o.isFree === true) continue;
    const u = 1 - clamp01(o.paidFraction);
    if (u <= 0) continue;
    // Diskon di POS dipotong dari total pesanan: prorata ke item (sama seperti penghitungan omzet per produk).
    const items = (o.items ?? []).filter(it => it.productId);
    const allItems = o.items ?? [];
    const itemsSubtotal = allItems.reduce((s, it) => s + (it.subtotal ?? (it.price ?? 0) * it.qty), 0);
    const scale = o.total != null && itemsSubtotal > 0 ? o.total / itemsSubtotal : 1;
    const rev = items.reduce((s, it) => s + (it.subtotal ?? (it.price ?? 0) * it.qty) * scale, 0);
    const qty = items.reduce((s, it) => s + it.qty, 0);
    if (qty <= 0) continue;
    orderCount++; orderQty += qty * u; orderRevenue += rev * u;
  }

  return {
    recapCount, recapQty: r2(recapQty), recapRevenue: Math.round(recapRevenue),
    orderCount, orderQty: r2(orderQty), orderRevenue: Math.round(orderRevenue),
    qty: r2(recapQty + orderQty), revenue: Math.round(recapRevenue) + Math.round(orderRevenue),
  };
}
