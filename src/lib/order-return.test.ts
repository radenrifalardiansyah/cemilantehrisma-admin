import { describe, expect, it } from 'vitest';
import { computeReturn } from './order-return';

const items = [{ price: 15_000, qty: 2 }, { price: 10_000, qty: 1 }]; // subtotal 40.000

describe('computeReturn', () => {
  it('tanpa diskon: nilai retur = harga × qty yang diretur', () => {
    const r = computeReturn(items, 0, 40_000, i => (i === 0 ? 1 : 0));
    expect(r).toMatchObject({ newSubtotal: 25_000, newTotal: 25_000, refund: 15_000, remainingQty: 2, returnedQty: 1 });
  });
  it('diskon dikurangi proporsional (10% dari 40.000 = 4.000)', () => {
    // retur 1 × 15.000 → subtotal 25.000, diskon 2.500, total 22.500; total lama 36.000
    const r = computeReturn(items, 4_000, 36_000, i => (i === 0 ? 1 : 0));
    expect(r.newDiscountAmount).toBe(2_500);
    expect(r.newTotal).toBe(22_500);
    expect(r.refund).toBe(13_500);
  });
  it('tidak ada retur → nilai retur 0', () => {
    expect(computeReturn(items, 4_000, 36_000, () => 0).refund).toBe(0);
  });
  it('retur semua item → remainingQty 0 (route menolak, minta Batalkan Pesanan)', () => {
    const r = computeReturn(items, 0, 40_000, i => items[i].qty);
    expect(r.remainingQty).toBe(0);
    expect(r.refund).toBe(40_000);
  });
  it('subtotal nol tidak membagi dengan nol', () => {
    expect(computeReturn([{ price: 0, qty: 1 }], 0, 0, () => 1).newDiscountAmount).toBe(0);
  });
});
