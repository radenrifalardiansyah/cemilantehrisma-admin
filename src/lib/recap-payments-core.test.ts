import { describe, expect, it } from 'vitest';
import {
  PaymentError, paidAtFromDate, recapPaymentRatio, recapPaymentState, recapRemaining, scaleRecapForPayment, settlesRecap, validateRecapPaymentAmount,
} from './recap-payments-core';

describe('status & sisa rekap', () => {
  it('belum_lunas: 0 dibayar = belum_lunas, sebagian = sebagian, sisa <= Rp1 = lunas', () => {
    expect(recapPaymentState({ paymentStatus: 'belum_lunas', total: 140_000, paid: 0 })).toBe('belum_lunas');
    expect(recapPaymentState({ paymentStatus: 'belum_lunas', total: 140_000, paid: 100_000 })).toBe('sebagian');
    expect(recapPaymentState({ paymentStatus: 'belum_lunas', total: 140_000, paid: 139_999 })).toBe('lunas');
  });
  it('kolom lunas (termasuk rekap lunas lama tanpa pembayaran) = lunas penuh, sisa 0', () => {
    expect(recapPaymentState({ paymentStatus: 'lunas', total: 140_000, paid: 0 })).toBe('lunas');
    expect(recapRemaining({ paymentStatus: 'lunas', total: 140_000, paid: 0 })).toBe(0);
    expect(recapPaymentState({ paymentStatus: undefined, total: 5, paid: 0 })).toBe('lunas'); // field hilang = lunas (data lama)
  });
  it('kasus pengguna: rekap 140.000, dibayar 100.000 → sisa 40.000 tetap piutang', () => {
    expect(recapRemaining({ paymentStatus: 'belum_lunas', total: 140_000, paid: 100_000 })).toBe(40_000);
  });
});

describe('validateRecapPaymentAmount', () => {
  it('menerima sampai sisa; menolak 0, negatif, bukan angka, dan melebihi sisa', () => {
    expect(validateRecapPaymentAmount(100_000, 140_000)).toBe(100_000);
    expect(validateRecapPaymentAmount('40000', 40_000)).toBe(40_000);
    for (const bad of [0, -1, 'abc', null, undefined, NaN]) expect(() => validateRecapPaymentAmount(bad, 40_000)).toThrow(PaymentError);
    expect(() => validateRecapPaymentAmount(40_001, 40_000)).toThrow(/melebihi sisa piutang/);
  });
  it('toleransi Rp1: bayar sisa-1 melunasi, sisa-2 tidak', () => {
    expect(settlesRecap(40_000, 39_999)).toBe(true);
    expect(settlesRecap(40_000, 39_998)).toBe(false);
  });
});

describe('paidAtFromDate', () => {
  const now = new Date('2026-11-16T03:00:00Z'); // 10:00 WIB
  it('hari ini (WIB) = sekarang; hari lain = 12:00 WIB', () => {
    expect(paidAtFromDate('2026-11-16', now)).toBe(now);
    expect(paidAtFromDate('2026-11-10', now).toISOString()).toBe('2026-11-10T05:00:00.000Z');
  });
  it('batas hari memakai WIB: 17:30Z = 00:30 WIB hari berikutnya', () => {
    const late = new Date('2026-11-16T17:30:00Z');
    expect(paidAtFromDate('2026-11-17', late)).toBe(late);
  });
});

describe('scaleRecapForPayment (pengakuan kas proporsional)', () => {
  // Rekap kotor 150.000 (10 pcs), biaya lain 10.000 → netto 140.000.
  const src = { totalRevenue: 140_000, otherCosts: [{ label: 'Admin', amount: 10_000 }], totalOtherCosts: 10_000,
    items: [{ productId: 'p1', qtySold: 10, revenue: 150_000, costPrice: 5_000 }] };
  it('pembayaran 100.000 dari netto 140.000 → rasio 5/7 untuk biaya, qty, omzet', () => {
    const r = scaleRecapForPayment(src, 100_000);
    expect(r.totalRevenue).toBe(100_000);
    expect(r.totalOtherCosts).toBeCloseTo(7_142.86, 2);
    expect(r.items[0].qtySold).toBeCloseTo(7.142857, 5);
    expect(r.items[0].revenue).toBeCloseTo(107_142.857, 2);
  });
  it('semua pembayaran dijumlah = rekap penuh (tidak dobel / hilang)', () => {
    const a = scaleRecapForPayment(src, 100_000), b = scaleRecapForPayment(src, 40_000);
    expect(a.items[0].qtySold + b.items[0].qtySold).toBeCloseTo(10, 9);
    expect(a.totalRevenue + a.totalOtherCosts + b.totalRevenue + b.totalOtherCosts).toBeCloseTo(150_000, 1);
  });
  it('rasio dibatasi 1 dan aman untuk total 0', () => {
    expect(recapPaymentRatio(200_000, 140_000)).toBe(1);
    expect(recapPaymentRatio(1, 0)).toBe(0);
  });
});
