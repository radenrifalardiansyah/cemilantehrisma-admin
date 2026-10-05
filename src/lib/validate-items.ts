// Validasi qty/harga item di body request — body dari klien tidak bisa dipercaya: qty negatif
// membalik arah stok (stok bertambah saat "keluar"), dan string seperti "5" membuat `stok + qty`
// jadi penggabungan teks. Mengembalikan pesan error (siap dikirim sebagai 400) atau null kalau valid.

type ItemLike = { qty?: unknown; price?: unknown; name?: string; productName?: string; materialName?: string };

function label(it: ItemLike, i: number) {
  return it.name || it.productName || it.materialName || `baris ${i + 1}`;
}

// Order & pengiriman konsinyasi: qty 0/kosong tetap boleh (barisnya memang dilewati di logika stok),
// tapi tidak boleh negatif, bukan angka, atau tak hingga.
export function invalidQtyMessage(items: unknown): string | null {
  if (items === undefined || items === null) return null;
  if (!Array.isArray(items)) return 'Daftar item tidak valid.';
  for (const [i, it] of (items as ItemLike[]).entries()) {
    const q = it?.qty;
    if (q === undefined || q === null || q === 0) continue;
    if (typeof q !== 'number' || !Number.isFinite(q) || q < 0) {
      return `Jumlah "${label(it, i)}" tidak valid — harus angka 0 atau lebih.`;
    }
  }
  return null;
}

// Pembelian bahan baku: qty wajib > 0, harga wajib >= 0, keduanya angka berhingga.
export function invalidPurchaseItemMessage(items: unknown): string | null {
  if (!Array.isArray(items)) return 'Daftar bahan baku tidak valid.';
  for (const [i, it] of (items as ItemLike[]).entries()) {
    const { qty, price } = it ?? {};
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
      return `Jumlah "${label(it, i)}" harus berupa angka lebih dari 0.`;
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return `Harga "${label(it, i)}" harus berupa angka 0 atau lebih.`;
    }
  }
  return null;
}
