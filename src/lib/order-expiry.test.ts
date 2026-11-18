import { describe, expect, it } from 'vitest';
import { UNPAID_ORDER_EXPIRY_HOURS, expiryCutoff, expiryCutoffMs, isExpirableUnpaidOrder, isOrderExpired, type ExpirableOrderState } from './order-expiry';

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const H = 3600_000;
const base: ExpirableOrderState = { source: 'portal', status: 'baru', paymentStatus: 'belum_lunas', transferProofUrl: null, fulfillmentStatus: null, createdAtMs: NOW - 25 * H };

describe('batas kedaluwarsa', () => {
  it('batasnya 24 jam', () => {
    expect(UNPAID_ORDER_EXPIRY_HOURS).toBe(24);
    expect(expiryCutoffMs(NOW)).toBe(NOW - 24 * H);
    expect(expiryCutoff(new Date(NOW)).getTime()).toBe(NOW - 24 * H);
  });
  it('tepat 24 jam belum kedaluwarsa, lewat sedikit sudah', () => {
    expect(isOrderExpired(NOW - 24 * H, NOW)).toBe(false);
    expect(isOrderExpired(NOW - 24 * H - 1, NOW)).toBe(true);
    expect(isOrderExpired(NOW - 1 * H, NOW)).toBe(false);
  });
  it('waktu tidak valid tidak dianggap kedaluwarsa', () => {
    expect(isOrderExpired(NaN, NOW)).toBe(false);
  });
});

describe('isExpirableUnpaidOrder', () => {
  it('pesanan portal belum bayar > 24 jam layak', () => {
    expect(isExpirableUnpaidOrder(base, NOW)).toBe(true);
  });
  it('bukti bayar sudah diupload dikecualikan (spasi saja dianggap kosong)', () => {
    expect(isExpirableUnpaidOrder({ ...base, transferProofUrl: 'https://res.cloudinary.com/x.jpg' }, NOW)).toBe(false);
    expect(isExpirableUnpaidOrder({ ...base, transferProofUrl: '  ' }, NOW)).toBe(true);
    expect(isExpirableUnpaidOrder({ ...base, transferProofUrl: '' }, NOW)).toBe(true);
  });
  it('fulfillment apa pun dikecualikan', () => {
    for (const f of ['diproses', 'dikirim', 'siap_diambil']) expect(isExpirableUnpaidOrder({ ...base, fulfillmentStatus: f }, NOW)).toBe(false);
  });
  it('bukan portal / bukan baru / sudah lunas / masih baru dibuat tidak layak', () => {
    expect(isExpirableUnpaidOrder({ ...base, source: 'kasir' }, NOW)).toBe(false);
    expect(isExpirableUnpaidOrder({ ...base, status: 'selesai' }, NOW)).toBe(false);
    expect(isExpirableUnpaidOrder({ ...base, status: 'dibatalkan' }, NOW)).toBe(false);
    expect(isExpirableUnpaidOrder({ ...base, paymentStatus: 'lunas' }, NOW)).toBe(false);
    expect(isExpirableUnpaidOrder({ ...base, createdAtMs: NOW - 23 * H }, NOW)).toBe(false);
  });
});
