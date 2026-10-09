import { resolveScheme, calcShare, type SchemeLevel, type SchemeSpec, type ShareResult } from '@/lib/consign';

// Logika murni Kasir Lapak (tanpa database) — dipakai route API dan diuji unit.

export type PaymentMethod = 'cash' | 'qris' | 'transfer';
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'qris', 'transfer'];

export interface SaleLineInput { kind: 'own' | 'consign'; productId: string; qty: number }

// Rapikan daftar item dari klien: gabungkan baris sama, tolak qty tidak valid / jenis salah.
export function mergeSaleLines(raw: unknown): { lines: SaleLineInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Keranjang kosong.' };
  const merged = new Map<string, SaleLineInput>();
  for (const r of raw as Record<string, unknown>[]) {
    const kind = r?.kind === 'own' ? 'own' : r?.kind === 'consign' ? 'consign' : null;
    const productId = typeof r?.productId === 'string' ? r.productId : '';
    const qty = Number(r?.qty);
    if (!kind || !productId) return { error: 'Item keranjang tidak valid.' };
    if (!Number.isFinite(qty) || qty <= 0) return { error: 'Jumlah item harus lebih dari 0.' };
    const key = `${kind}:${productId}`;
    const prev = merged.get(key);
    merged.set(key, { kind, productId, qty: (prev?.qty ?? 0) + qty });
  }
  return { lines: [...merged.values()] };
}

// Harga & bagi hasil satu unit barang titipan di lapak: lapak → produk → default penitip.
// null spec = skema belum ditentukan → barang tidak boleh dijual.
export function consignUnitPricing(opts: {
  defaultPrice: number; stallPrice: number | null;
  stallScheme: SchemeLevel; productScheme: SchemeLevel; consignorScheme: SchemeLevel;
}): { price: number; spec: SchemeSpec | null; share: ShareResult | null } {
  const price = opts.stallPrice ?? opts.defaultPrice;
  const spec = resolveScheme([opts.stallScheme, opts.productScheme, opts.consignorScheme]);
  return { price, spec, share: spec ? calcShare(price, spec) : null };
}

// Diskon ditanggung toko: bagian penitip tidak berkurang, jadi diskon tidak boleh melebihi
// bagian toko (barang sendiri + bagian toko dari barang titipan).
export function discountProblem(discount: number, maxDiscount: number): string | null {
  if (!Number.isFinite(discount) || discount < 0) return 'Diskon tidak valid.';
  if (discount > maxDiscount) {
    return `Diskon maksimal Rp${Math.floor(maxDiscount).toLocaleString('id-ID')} (bagian penitip tidak ikut berkurang).`;
  }
  return null;
}

export function paymentResult(method: unknown, total: number, amountPaid: unknown): { method: PaymentMethod; amountPaid: number; change: number } | { error: string } {
  if (!PAYMENT_METHODS.includes(method as PaymentMethod)) return { error: 'Metode pembayaran tidak valid.' };
  const m = method as PaymentMethod;
  if (m !== 'cash') return { method: m, amountPaid: total, change: 0 };
  const paid = Number(amountPaid);
  if (!Number.isFinite(paid) || paid < total) return { error: 'Uang yang diterima kurang dari total.' };
  return { method: m, amountPaid: paid, change: paid - total };
}
