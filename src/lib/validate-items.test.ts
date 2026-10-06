import { describe, expect, it } from 'vitest';
import { invalidPurchaseItemMessage, invalidQtyMessage } from './validate-items';

describe('invalidQtyMessage', () => {
  it('menolak qty negatif, string, dan tak hingga (membalik arah stok)', () => {
    expect(invalidQtyMessage([{ name: 'A', qty: -1 }])).toMatch(/tidak valid/);
    expect(invalidQtyMessage([{ name: 'A', qty: '5' }])).toMatch(/tidak valid/);
    expect(invalidQtyMessage([{ name: 'A', qty: Infinity }])).toMatch(/tidak valid/);
  });
  it('qty 0/kosong/undefined boleh; bukan array ditolak', () => {
    expect(invalidQtyMessage([{ name: 'A', qty: 0 }, { name: 'B' }, { name: 'C', qty: 3 }])).toBeNull();
    expect(invalidQtyMessage(undefined)).toBeNull();
    expect(invalidQtyMessage('x')).toMatch(/tidak valid/);
  });
});

describe('invalidPurchaseItemMessage', () => {
  it('qty harus > 0 dan harga >= 0', () => {
    expect(invalidPurchaseItemMessage([{ name: 'Tepung', qty: 0, price: 1000 }])).toMatch(/lebih dari 0/);
    expect(invalidPurchaseItemMessage([{ name: 'Tepung', qty: 2, price: -1 }])).toMatch(/0 atau lebih/);
    expect(invalidPurchaseItemMessage([{ name: 'Tepung', qty: 2, price: 0 }])).toBeNull();
  });
});
