import { describe, it, expect } from 'vitest';
import { computeUnpaid } from './product-report-unpaid';

describe('computeUnpaid', () => {
  it('rekap belum lunas penuh dihitung seluruhnya; lunas diabaikan', () => {
    const r = computeUnpaid([], [
      { paidFraction: 0, items: [{ qtySold: 10, revenue: 100_000 }, { qtySold: 5, hargaTitip: 8_000 }] },
      { paidFraction: 1, items: [{ qtySold: 99, revenue: 999_999 }] },
    ]);
    expect(r).toMatchObject({ recapCount: 1, recapQty: 15, recapRevenue: 140_000, orderCount: 0, qty: 15, revenue: 140_000 });
  });
  it('rekap/pesanan yang dicicil: hanya sisa yang belum dibayar', () => {
    const r = computeUnpaid(
      [{ status: 'selesai', paidFraction: 0.25, total: 200_000, items: [{ productId: 'p', qty: 10, subtotal: 200_000 }] }],
      [{ paidFraction: 0.5, items: [{ qtySold: 10, revenue: 100_000 }] }],
    );
    expect(r.recapQty).toBe(5); expect(r.recapRevenue).toBe(50_000);
    expect(r.orderQty).toBe(7.5); expect(r.orderRevenue).toBe(150_000);
    expect(r.revenue).toBe(200_000); expect(r.qty).toBe(12.5);
  });
  it('pesanan baru, dibatalkan, gratis, dan item tanpa produk tidak dihitung; diskon diprorata', () => {
    const r = computeUnpaid([
      { status: 'baru', paidFraction: 0, total: 50_000, items: [{ productId: 'p', qty: 1, subtotal: 50_000 }] },
      { status: 'dibatalkan', paidFraction: 0, total: 50_000, items: [{ productId: 'p', qty: 1, subtotal: 50_000 }] },
      { status: 'selesai', isFree: true, paidFraction: 0, total: 0, items: [{ productId: 'p', qty: 3, subtotal: 30_000 }] },
      { status: 'selesai', paidFraction: 0, total: 90_000, items: [{ productId: 'p', qty: 2, subtotal: 100_000 }, { qty: 1, subtotal: 0 }] },
    ], []);
    expect(r.orderCount).toBe(1); expect(r.orderQty).toBe(2); expect(r.orderRevenue).toBe(90_000);
  });
  it('kosong -> semua nol', () => {
    expect(computeUnpaid([], [])).toEqual({ recapCount: 0, recapQty: 0, recapRevenue: 0, orderCount: 0, orderQty: 0, orderRevenue: 0, qty: 0, revenue: 0 });
  });
});
