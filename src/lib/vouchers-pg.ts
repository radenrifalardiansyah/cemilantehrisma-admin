import { computeVoucherDiscount, type VoucherRule } from '@/lib/voucher';

export interface VoucherRow {
  code: string; description: string | null; type: 'percent' | 'nominal'; value: string;
  min_purchase: string; max_discount: string; valid_from: string | null; valid_until: string | null;
  usage_limit: number; used_count: number; is_active: boolean; created_at: Date; updated_at: Date | null;
}

export function rowToVoucher(r: VoucherRow) {
  return {
    code: r.code,
    description: r.description ?? '',
    type: r.type,
    value: Number(r.value),
    minPurchase: Number(r.min_purchase),
    maxDiscount: Number(r.max_discount),
    validFrom: r.valid_from ?? '',
    validUntil: r.valid_until ?? '',
    usageLimit: r.usage_limit,
    usedCount: r.used_count,
    isActive: r.is_active,
  };
}

export function voucherRule(r: VoucherRow): VoucherRule {
  return { type: r.type, value: Number(r.value), minPurchase: Number(r.min_purchase), maxDiscount: Number(r.max_discount) };
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Mengembalikan pesan error (siap tampil) atau null kalau voucher boleh dipakai untuk subtotal ini.
export function voucherProblem(r: VoucherRow | undefined, subtotal: number, now = new Date()): string | null {
  if (!r) return 'Kode voucher tidak ditemukan.';
  if (!r.is_active) return 'Voucher ini sudah tidak aktif.';
  const today = new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
  if (r.valid_from && today < r.valid_from) return 'Voucher ini belum berlaku.';
  if (r.valid_until && today > r.valid_until) return 'Voucher ini sudah kedaluwarsa.';
  if (r.usage_limit > 0 && r.used_count >= r.usage_limit) return 'Kuota voucher ini sudah habis.';
  const min = Number(r.min_purchase);
  if (min > 0 && subtotal < min) return `Minimal belanja Rp${min.toLocaleString('id-ID')} untuk memakai voucher ini.`;
  if (computeVoucherDiscount(voucherRule(r), subtotal) <= 0) return 'Voucher tidak memberi potongan untuk belanja ini.';
  return null;
}
