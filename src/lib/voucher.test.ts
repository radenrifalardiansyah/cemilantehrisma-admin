import { describe, expect, it } from 'vitest';
import { computeVoucherDiscount, normalizeVoucherCode, voucherDiscountLabel } from './voucher';
import { voucherProblem, type VoucherRow } from './vouchers-pg';

const percent = { type: 'percent' as const, value: 10, minPurchase: 0, maxDiscount: 0 };

describe('computeVoucherDiscount', () => {
  it('menghitung persen dari subtotal', () => {
    expect(computeVoucherDiscount(percent, 30_000)).toBe(3_000);
  });
  it('membatasi persen dengan maxDiscount', () => {
    expect(computeVoucherDiscount({ ...percent, maxDiscount: 5_000 }, 100_000)).toBe(5_000);
  });
  it('nominal tidak pernah melebihi subtotal', () => {
    expect(computeVoucherDiscount({ type: 'nominal', value: 50_000, minPurchase: 0, maxDiscount: 0 }, 30_000)).toBe(30_000);
  });
  it('subtotal nol atau negatif → tanpa potongan', () => {
    expect(computeVoucherDiscount(percent, 0)).toBe(0);
    expect(computeVoucherDiscount(percent, -5)).toBe(0);
  });
});

describe('normalizeVoucherCode', () => {
  it('huruf besar, buang karakter selain A-Z0-9_-', () => {
    expect(normalizeVoucherCode(' hemat 10! ')).toBe('HEMAT10');
    expect(normalizeVoucherCode(undefined)).toBe('');
  });
  it('label diskon', () => {
    expect(voucherDiscountLabel('HEMAT10')).toBe('Voucher HEMAT10');
  });
});

const row = (over: Partial<VoucherRow> = {}): VoucherRow => ({
  code: 'X', description: null, type: 'percent', value: '10', min_purchase: '20000', max_discount: '0',
  valid_from: null, valid_until: null, usage_limit: 0, used_count: 0, is_active: true,
  created_at: new Date(), updated_at: null, ...over,
});
const NOW = new Date('2026-10-06T05:00:00Z'); // 12.00 WIB

describe('voucherProblem', () => {
  it('voucher tidak ditemukan', () => expect(voucherProblem(undefined, 50_000, NOW)).toMatch(/tidak ditemukan/));
  it('nonaktif', () => expect(voucherProblem(row({ is_active: false }), 50_000, NOW)).toMatch(/tidak aktif/));
  it('belum berlaku & kedaluwarsa (hari kalender WIB, hari terakhir masih sah)', () => {
    expect(voucherProblem(row({ valid_from: '2026-10-07' }), 50_000, NOW)).toMatch(/belum berlaku/);
    expect(voucherProblem(row({ valid_until: '2026-10-05' }), 50_000, NOW)).toMatch(/kedaluwarsa/);
    expect(voucherProblem(row({ valid_until: '2026-10-06' }), 50_000, NOW)).toBeNull();
  });
  it('kuota habis', () => {
    expect(voucherProblem(row({ usage_limit: 2, used_count: 2 }), 50_000, NOW)).toMatch(/Kuota/);
    expect(voucherProblem(row({ usage_limit: 2, used_count: 1 }), 50_000, NOW)).toBeNull();
  });
  it('minimal belanja', () => {
    expect(voucherProblem(row(), 10_000, NOW)).toMatch(/Minimal belanja/);
    expect(voucherProblem(row(), 20_000, NOW)).toBeNull();
  });
});
