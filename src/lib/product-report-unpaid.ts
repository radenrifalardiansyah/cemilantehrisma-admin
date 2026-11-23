// Bagian penjualan di Laporan Produk yang SUDAH tercatat (direkap / pesanan sudah diproses) tetapi BELUM terbayar.
// Laporan Produk hanya menghitung porsi yang sudah dibayar (paidFraction) sebagai penjualan; porsi sisanya dijumlahkan
// di sini supaya kelihatan berapa piutang yang masih menggantung. Murni (tanpa DB) supaya bisa diuji.

export interface UnpaidOrderInput {
  status?: string; isFree?: boolean; paidFraction: number; total?: number;
  items?: { productId?: string; name?: string; qty: number; price?: number; subtotal?: number }[];
}
export interface UnpaidRecapInput {
  paidFraction: number;
  items?: { productId?: string; productName?: string; qtySold: number; revenue?: number; hargaTitip?: number }[];
}
export interface UnpaidProductRow {
  key: string; productId: string; name: string;
  qtyRecap: number; qtyOrder: number; qty: number; revenue: number;
}
export interface UnpaidSummary {
  recapCount: number; recapQty: number; recapRevenue: number;
  orderCount: number; orderQty: number; orderRevenue: number;
  qty: number; revenue: number;
  /** Rincian per produk, omzet belum terbayar terbesar dulu. */
  byProduct: UnpaidProductRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function computeUnpaid(orders: UnpaidOrderInput[], recaps: UnpaidRecapInput[]): UnpaidSummary {
  const byProduct = new Map<string, { productId: string; name: string; qtyRecap: number; qtyOrder: number; revenue: number }>();
  const addProduct = (productId: string | undefined, name: string | undefined, kind: 'recap' | 'order', qty: number, revenue: number) => {
    const key = productId || `__noid__${name ?? '(tanpa nama)'}`;
    const row = byProduct.get(key) ?? { productId: productId ?? '', name: name || '(tanpa nama)', qtyRecap: 0, qtyOrder: 0, revenue: 0 };
    if (kind === 'recap') row.qtyRecap += qty; else row.qtyOrder += qty;
    row.revenue += revenue;
    byProduct.set(key, row);
  };
  let recapCount = 0, recapQty = 0, recapRevenue = 0;
  for (const rec of recaps) {
    const u = 1 - clamp01(rec.paidFraction);
    if (u <= 0) continue;
    const items = rec.items ?? [];
    const rev = items.reduce((s, it) => s + (it.revenue ?? (it.hargaTitip ?? 0) * it.qtySold), 0);
    const qty = items.reduce((s, it) => s + it.qtySold, 0);
    if (qty <= 0 && rev <= 0) continue;
    recapCount++; recapQty += qty * u; recapRevenue += rev * u;
    items.forEach(it => addProduct(it.productId, it.productName, 'recap', it.qtySold * u, (it.revenue ?? (it.hargaTitip ?? 0) * it.qtySold) * u));
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
    items.forEach(it => addProduct(it.productId, it.name, 'order', it.qty * u, (it.subtotal ?? (it.price ?? 0) * it.qty) * scale * u));
  }

  return {
    recapCount, recapQty: r2(recapQty), recapRevenue: Math.round(recapRevenue),
    orderCount, orderQty: r2(orderQty), orderRevenue: Math.round(orderRevenue),
    qty: r2(recapQty + orderQty), revenue: Math.round(recapRevenue) + Math.round(orderRevenue),
    byProduct: [...byProduct.entries()]
      .map(([key, p]) => ({ key, productId: p.productId, name: p.name, qtyRecap: r2(p.qtyRecap), qtyOrder: r2(p.qtyOrder), qty: r2(p.qtyRecap + p.qtyOrder), revenue: Math.round(p.revenue) }))
      .filter(p => p.qty > 0 || p.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name, 'id')),
  };
}
