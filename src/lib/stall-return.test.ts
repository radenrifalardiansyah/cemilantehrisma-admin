import { describe, it, expect } from 'vitest';
import { computeReturn, remainingQty } from './stall-return';

const items = [{ price: 12000, qty: 2 }, { price: 5000, qty: 3, returnedQty: 1 }];

describe('computeReturn', () => {
  it('tanpa diskon: refund = harga × qty', () => {
    expect(computeReturn(items, 39000, 0, [{ index: 0, qty: 1 }])).toEqual({ lines: [{ index: 0, qty: 1, gross: 12000 }], refund: 12000 });
  });
  it('dengan diskon: refund dikurangi bagian diskon secara proporsional', () => {
    // subtotal 39.000, diskon 3.900 (10%) → refund 12.000 × 0,9 = 10.800
    const r = computeReturn(items, 39000, 3900, [{ index: 0, qty: 1 }]);
    expect('refund' in r && r.refund).toBe(10800);
  });
  it('menghormati retur sebelumnya (sisa)', () => {
    expect(remainingQty(items[1])).toBe(2);
    expect('error' in computeReturn(items, 39000, 0, [{ index: 1, qty: 3 }])).toBe(true);
    expect('refund' in computeReturn(items, 39000, 0, [{ index: 1, qty: 2 }])).toBe(true);
  });
  it('menolak pilihan kosong, qty <= 0, index salah, dan index ganda', () => {
    expect('error' in computeReturn(items, 1, 0, [])).toBe(true);
    expect('error' in computeReturn(items, 1, 0, [{ index: 0, qty: 0 }])).toBe(true);
    expect('error' in computeReturn(items, 1, 0, [{ index: 9, qty: 1 }])).toBe(true);
    expect('error' in computeReturn(items, 1, 0, [{ index: 0, qty: 1 }, { index: 0, qty: 1 }])).toBe(true);
  });
  it('retur semua barang dengan diskon = total yang dibayar pelanggan', () => {
    const r = computeReturn([{ price: 10000, qty: 2 }], 20000, 2000, [{ index: 0, qty: 2 }]);
    expect('refund' in r && r.refund).toBe(18000);
  });
});
