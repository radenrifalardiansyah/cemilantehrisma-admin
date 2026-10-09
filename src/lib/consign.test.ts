import { describe, it, expect } from 'vitest';
import { resolveScheme, calcShare, validateScheme } from './consign';

describe('calcShare', () => {
  it('nominal: setor Rp10.000, jual Rp12.000 → kita Rp2.000', () => {
    expect(calcShare(12000, { scheme: 'nominal', value: 10000 })).toEqual({ consignor: 10000, ours: 2000 });
  });
  it('komisi 15% dari Rp13.000 → kita Rp1.950, penitip Rp11.050', () => {
    expect(calcShare(13000, { scheme: 'commission', value: 15 })).toEqual({ consignor: 11050, ours: 1950 });
  });
  it('komisi: bagian penitip + bagian kita selalu sama dengan harga (tanpa selisih pembulatan)', () => {
    for (const price of [999, 1001, 12345, 7]) {
      const s = calcShare(price, { scheme: 'commission', value: 12.5 });
      expect(s.consignor + s.ours).toBe(price);
    }
  });
});

describe('resolveScheme', () => {
  const consignor = { scheme: 'nominal' as const, value: 5000 };
  it('lapak menimpa produk dan penitip', () => {
    expect(resolveScheme([{ scheme: 'commission', value: 20 }, { scheme: 'nominal', value: 9000 }, consignor]))
      .toEqual({ scheme: 'commission', value: 20 });
  });
  it('produk menimpa penitip kalau lapak ikut default', () => {
    expect(resolveScheme([{ scheme: null, value: null }, { scheme: 'nominal', value: 9000 }, consignor]))
      .toEqual({ scheme: 'nominal', value: 9000 });
  });
  it('jatuh ke default penitip; skema dan nilai tidak dicampur antar tingkat', () => {
    expect(resolveScheme([{ scheme: null, value: 99 }, null, consignor])).toEqual({ scheme: 'nominal', value: 5000 });
  });
  it('null kalau tidak ada tingkat yang menentukan skema (penitip "belum ditentukan")', () => {
    expect(resolveScheme([{ scheme: null, value: null }, { scheme: null, value: null }, { scheme: null, value: 0 }])).toBeNull();
  });
});

describe('validateScheme', () => {
  it('menolak komisi > 100% dan nilai negatif', () => {
    expect(validateScheme('commission', 101)).not.toBeNull();
    expect(validateScheme('nominal', -1)).not.toBeNull();
  });
  it('menolak harga setor di atas harga jual, menerima yang wajar', () => {
    expect(validateScheme('nominal', 13000, 12000)).not.toBeNull();
    expect(validateScheme('nominal', 10000, 12000)).toBeNull();
    expect(validateScheme('commission', 15, 12000)).toBeNull();
  });
});
