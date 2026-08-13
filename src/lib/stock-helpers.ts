interface MaterialStockLike { stockQty?: number; minStock?: number }

// Menipis = stok masih ada tapi sudah di batas minimum — dipakai analytics/overview (badge
// jumlah menipis) dan production route (trigger notifikasi saat stok baru melewati ambang).
export const isMaterialLowStock = (m: MaterialStockLike) =>
  (m.minStock ?? 0) > 0 && (m.stockQty ?? 0) > 0 && (m.stockQty ?? 0) <= (m.minStock ?? 0);
