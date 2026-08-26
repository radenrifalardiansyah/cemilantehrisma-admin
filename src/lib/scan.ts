import type { PosProduct } from '@/lib/pos-types';

/** Resolves a scanned QR value (default = product detail URL, e.g. ".../products/{id}") to a product id. */
export function resolveScannedProductId(text: string, products: PosProduct[]): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/products\/([^/?#]+)/);
  const candidateId = match ? decodeURIComponent(match[1]) : trimmed;
  return products.find(p => p.id === candidateId)?.id ?? null;
}
