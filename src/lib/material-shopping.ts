// Daftar Belanja bahan baku (tabel material_shopping_items) — bentuk JSON ke frontend.

export interface ShoppingItemRow {
  id: string;
  material_id: string;
  material_name: string;
  material_unit: string;
  qty: string;
  price: string | null;
  note: string | null;
  shopping_date: string;
  supplier_id: string | null;
  supplier_name: string;
  checked: boolean;
  status: string;
  purchase_id: string | null;
  created_by: string | null;
  created_at: Date;
  done_at: Date | null;
}

export function rowToShoppingItem(r: ShoppingItemRow) {
  return {
    id: r.id,
    materialId: r.material_id,
    materialName: r.material_name,
    unit: r.material_unit,
    qty: Number(r.qty),
    price: r.price != null ? Number(r.price) : null,
    note: r.note ?? '',
    shoppingDate: r.shopping_date,
    supplierId: r.supplier_id ?? undefined,
    supplierName: r.supplier_name ?? '',
    checked: r.checked,
    status: r.status as 'pending' | 'done',
    purchaseId: r.purchase_id ?? undefined,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at.toISOString(),
    doneAt: r.done_at ? r.done_at.toISOString() : undefined,
  };
}
