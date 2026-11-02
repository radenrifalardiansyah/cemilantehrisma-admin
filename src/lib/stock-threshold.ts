// Dipisah dari ProductsTab/MaterialsTab supaya page.tsx bisa memakainya tanpa ikut memuat kedua tab itu.

// Menipis = stok masih ada (bukan habis/PO) tapi sudah di batas minimum yang diset admin.
export const isProductLowStock = (p: { stockQty?: number | null; openPO?: boolean | null; minStock?: number | null }) =>
  !p.openPO && (p.minStock ?? 0) > 0 && (p.stockQty ?? 0) > 0 && (p.stockQty ?? 0) <= (p.minStock ?? 0);

// Menipis = stok masih ada tapi sudah di batas minimum yang diset admin.
export const isMaterialLowStock = (m: { stockQty: number; minStock?: number | null }) =>
  (m.minStock ?? 0) > 0 && m.stockQty > 0 && m.stockQty <= (m.minStock ?? 0);
