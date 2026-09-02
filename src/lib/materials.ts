import { getSql, parseJsonb } from '@/lib/db';

// Dipakai oleh DELETE satuan dan bulk-delete bahan baku — bahan baku yang masih direferensikan
// pembelian bahan baku atau batch produksi tidak boleh dihapus permanen. Tanpa guard ini, dokumen
// lama yang masih menyimpan materialId ini jadi anak yatim: production DELETE's restore loop
// diam-diam melewati baris yang materialnya sudah tidak ada, jadi menghapus batch produksi
// setelahnya TIDAK benar-benar mengembalikan stok material itu, tanpa peringatan apa pun ke user.
export async function referencedMaterialIds(): Promise<Set<string>> {
  const sql = getSql();
  const [purchaseRows, batchRows, adjustmentRows] = await Promise.all([
    sql<{ items: unknown }[]>`select items from material_purchases`,
    sql<{ materials_used: unknown }[]>`select materials_used from production_batches`,
    sql<{ material_id: string }[]>`select distinct material_id from material_adjustments`,
  ]);
  const ids = new Set<string>();
  purchaseRows.forEach(r => {
    ((parseJsonb(r.items) as { materialId: string }[] | null) ?? []).forEach(it => ids.add(it.materialId));
  });
  batchRows.forEach(r => {
    ((parseJsonb(r.materials_used) as { materialId: string }[] | null) ?? []).forEach(m => ids.add(m.materialId));
  });
  adjustmentRows.forEach(r => ids.add(r.material_id));
  return ids;
}
