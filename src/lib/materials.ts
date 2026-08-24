import type { Firestore } from 'firebase-admin/firestore';

// Dipakai oleh DELETE satuan dan bulk-delete bahan baku — bahan baku yang masih direferensikan
// pembelian bahan baku atau batch produksi tidak boleh dihapus permanen. Tanpa guard ini, dokumen
// lama yang masih menyimpan materialId ini jadi anak yatim: production DELETE's restore loop
// diam-diam melewati baris yang materialnya sudah tidak ada (`if (!materialSnaps[i].exists) return;`),
// jadi menghapus batch produksi setelahnya TIDAK benar-benar mengembalikan stok material itu,
// tanpa peringatan apa pun ke user.
export async function referencedMaterialIds(db: Firestore): Promise<Set<string>> {
  const [purchasesSnap, batchesSnap] = await Promise.all([
    db.collection('materialPurchases').get(),
    db.collection('productionBatches').get(),
  ]);
  const ids = new Set<string>();
  purchasesSnap.docs.forEach(d => {
    ((d.data().items as { materialId: string }[] | undefined) ?? []).forEach(it => ids.add(it.materialId));
  });
  batchesSnap.docs.forEach(d => {
    ((d.data().materialsUsed as { materialId: string }[] | undefined) ?? []).forEach(m => ids.add(m.materialId));
  });
  return ids;
}
