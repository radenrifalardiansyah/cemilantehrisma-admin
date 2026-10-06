// Aturan voucher dipakai bersama klien (pratinjau di Kasir) dan server (sumber kebenaran saat
// pesanan disimpan) — satu rumus supaya angka di layar kasir sama dengan yang tercatat.

export interface VoucherRule {
  type: 'percent' | 'nominal';
  value: number;
  minPurchase: number;   // 0 = tanpa minimum
  maxDiscount: number;   // 0 = tanpa batas (relevan untuk persen)
}

export function computeVoucherDiscount(rule: VoucherRule, subtotal: number): number {
  if (subtotal <= 0) return 0;
  const raw = rule.type === 'percent' ? Math.round(subtotal * rule.value / 100) : rule.value;
  const capped = rule.maxDiscount > 0 ? Math.min(raw, rule.maxDiscount) : raw;
  return Math.max(0, Math.min(capped, subtotal));
}

export function voucherDiscountLabel(code: string): string {
  return `Voucher ${code}`;
}

export function normalizeVoucherCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}
