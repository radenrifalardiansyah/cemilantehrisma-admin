// Validasi body voucher (dipakai POST dan PUT) — nilai di-clamp di server, bukan hanya di form.
export interface ParsedVoucher {
  description: string | null; type: 'percent' | 'nominal'; value: number; minPurchase: number; maxDiscount: number;
  validFrom: string | null; validUntil: string | null; usageLimit: number; perCustomerLimit: number; isActive: boolean;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseVoucherBody(b: Record<string, unknown>): { value: ParsedVoucher } | { error: string } {
  const type = b.type === 'nominal' ? 'nominal' : b.type === 'percent' ? 'percent' : null;
  if (!type) return { error: 'Jenis voucher tidak valid.' };
  const value = Number(b.value);
  if (!Number.isFinite(value) || value <= 0) return { error: 'Nilai voucher harus lebih dari 0.' };
  if (type === 'percent' && value > 100) return { error: 'Voucher persen maksimal 100%.' };
  const num = (x: unknown) => Math.max(0, Math.floor(Number(x) || 0));
  const date = (x: unknown) => (typeof x === 'string' && YMD.test(x) ? x : null);
  const validFrom = date(b.validFrom);
  const validUntil = date(b.validUntil);
  if (validFrom && validUntil && validUntil < validFrom) return { error: 'Tanggal berakhir tidak boleh sebelum tanggal mulai.' };
  return {
    value: {
      description: typeof b.description === 'string' && b.description.trim() ? b.description.trim().slice(0, 120) : null,
      type, value,
      minPurchase: num(b.minPurchase), maxDiscount: num(b.maxDiscount),
      validFrom, validUntil, usageLimit: num(b.usageLimit), perCustomerLimit: num(b.perCustomerLimit),
      isActive: b.isActive !== false,
    },
  };
}
