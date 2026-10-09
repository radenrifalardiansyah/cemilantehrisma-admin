import { describe, it, expect } from 'vitest';
import { mergeSaleLines, consignUnitPricing, discountProblem, paymentResult } from './stall-pos';

const none = { scheme: null, value: null } as const;

describe('mergeSaleLines', () => {
  it('menggabungkan baris yang sama dan membedakan jenis', () => {
    const r = mergeSaleLines([
      { kind: 'consign', productId: 'a', qty: 1 }, { kind: 'consign', productId: 'a', qty: 2 }, { kind: 'own', productId: 'a', qty: 1 },
    ]);
    expect('lines' in r && r.lines).toEqual([
      { kind: 'consign', productId: 'a', qty: 3 }, { kind: 'own', productId: 'a', qty: 1 },
    ]);
  });
  it('menolak kosong, qty <= 0, dan jenis salah', () => {
    expect('error' in mergeSaleLines([])).toBe(true);
    expect('error' in mergeSaleLines([{ kind: 'own', productId: 'a', qty: 0 }])).toBe(true);
    expect('error' in mergeSaleLines([{ kind: 'x', productId: 'a', qty: 1 }])).toBe(true);
  });
});

describe('consignUnitPricing', () => {
  it('harga lapak menimpa default; setor Rp10.000 dari jual Rp12.000 → kita Rp2.000', () => {
    const r = consignUnitPricing({ defaultPrice: 11000, stallPrice: 12000, stallScheme: none, productScheme: { scheme: 'nominal', value: 10000 }, consignorScheme: none });
    expect(r.price).toBe(12000);
    expect(r.share).toEqual({ consignor: 10000, ours: 2000 });
  });
  it('skema belum ditentukan → share null (tidak boleh dijual)', () => {
    const r = consignUnitPricing({ defaultPrice: 5000, stallPrice: null, stallScheme: none, productScheme: none, consignorScheme: none });
    expect(r.spec).toBeNull();
    expect(r.share).toBeNull();
  });
});

describe('discountProblem', () => {
  it('diskon tidak boleh negatif atau melebihi bagian toko', () => {
    expect(discountProblem(-1, 1000)).not.toBeNull();
    expect(discountProblem(1500, 1000)).not.toBeNull();
    expect(discountProblem(1000, 1000)).toBeNull();
    expect(discountProblem(0, 0)).toBeNull();
  });
});

describe('paymentResult', () => {
  it('tunai: hitung kembalian, tolak kurang bayar', () => {
    expect(paymentResult('cash', 12000, 20000)).toEqual({ method: 'cash', amountPaid: 20000, change: 8000 });
    expect('error' in paymentResult('cash', 12000, 10000)).toBe(true);
  });
  it('qris/transfer: dibayar pas sesuai total', () => {
    expect(paymentResult('qris', 12000, undefined)).toEqual({ method: 'qris', amountPaid: 12000, change: 0 });
  });
  it('menolak metode tak dikenal (mis. kredit)', () => {
    expect('error' in paymentResult('kredit', 1000, 1000)).toBe(true);
  });
});
