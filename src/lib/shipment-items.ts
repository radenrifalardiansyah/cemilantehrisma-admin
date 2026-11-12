// Normalisasi item Kirim Stok dari body request (dipakai POST dan PUT supaya dokumen tersimpan seragam).
// Modul murni — tanpa import server.

export interface SendItemInput { productId: string; productName: string; qty: number; hargaTitip: number }

// Gabungkan baris ganda untuk produk yang sama sebelum disimpan (efek stok baru terjadi saat approve,
// memakai items yang tersimpan ini). qty dipaksa angka (Number()||0); Harga Titip dibulatkan — disimpan &
// diedit sebagai Rupiah bulat (NumberInput di form Kirim), jadi rata-rata tertimbang antar baris duplikat
// tidak boleh menghasilkan desimal yang rusak begitu shipment dibuka lagi di Edit Kirim.
export function mergeItems(items: SendItemInput[]): SendItemInput[] {
  const merged = new Map<string, SendItemInput>();
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const harga = Number(it.hargaTitip) || 0;
    const existing = merged.get(it.productId);
    if (existing) {
      const totalQty = existing.qty + qty;
      existing.hargaTitip = totalQty > 0 ? Math.round((existing.qty * existing.hargaTitip + qty * harga) / totalQty) : Math.round(harga);
      existing.qty = totalQty;
    } else {
      merged.set(it.productId, { ...it, qty, hargaTitip: Math.round(harga) });
    }
  }
  return [...merged.values()];
}

// Dipakai PUT: normalisasi seperti POST + tolak qty tidak valid (NaN / <= 0 / bukan angka) dan harga negatif,
// supaya edit tidak bisa menyimpan baris yang kemudian merusak efek stok saat approve.
export function normalizeEditItems(items: unknown): { items: SendItemInput[] } | { error: string } {
  if (!Array.isArray(items) || items.length === 0) return { error: 'Minimal 1 produk dikirim.' };
  for (const [i, raw] of (items as Partial<SendItemInput>[]).entries()) {
    const name = raw?.productName || `baris ${i + 1}`;
    if (!raw || typeof raw.productId !== 'string' || !raw.productId) return { error: `Produk pada baris ${i + 1} tidak valid.` };
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { error: `Jumlah "${name}" harus berupa angka lebih dari 0.` };
    const harga = Number(raw.hargaTitip ?? 0);
    if (!Number.isFinite(harga) || harga < 0) return { error: `Harga titip "${name}" harus berupa angka 0 atau lebih.` };
  }
  return { items: mergeItems(items as SendItemInput[]) };
}
