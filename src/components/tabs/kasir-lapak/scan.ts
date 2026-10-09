import type { CatalogItem } from './types';

// Cocokkan hasil scan QR/barcode ke barang di katalog lapak: id produk, kode produk (mis. TJP001), atau
// URL produk toko (".../products/{id}"). Tidak peka huruf besar/kecil untuk kode. null = tidak ditemukan.
export function resolveStallScan(text: string, items: CatalogItem[]): CatalogItem | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/\/products\/([^/?#]+)/);
  const candidate = m ? decodeURIComponent(m[1]) : t;
  const lower = candidate.toLowerCase();
  return items.find(i => i.productId === candidate)
    ?? items.find(i => !!i.code && i.code.toLowerCase() === lower)
    ?? null;
}
