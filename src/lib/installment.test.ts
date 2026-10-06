import { describe, expect, it } from 'vitest';
import { installmentState, paymentProblem } from './installment';

describe('installmentState', () => {
  it('sisa dan status lunas', () => {
    expect(installmentState(100_000, 40_000)).toEqual({ total: 100_000, paid: 40_000, remaining: 60_000, isPaidOff: false });
    expect(installmentState(100_000, 100_000).isPaidOff).toBe(true);
    expect(installmentState(100_000, 120_000).remaining).toBe(0);
  });
});

describe('paymentProblem', () => {
  it('menerima cicilan sampai tepat sisa', () => {
    expect(paymentProblem(100_000, 40_000, 60_000)).toBeNull();
    expect(paymentProblem(100_000, 0, 1)).toBeNull();
  });
  it('menolak melebihi sisa, nol/negatif/pecahan/bukan angka, dan pesanan yang sudah lunas', () => {
    expect(paymentProblem(100_000, 40_000, 60_001)).toMatch(/melebihi sisa/);
    expect(paymentProblem(100_000, 0, 0)).toMatch(/bilangan bulat/);
    expect(paymentProblem(100_000, 0, -5)).toMatch(/bilangan bulat/);
    expect(paymentProblem(100_000, 0, 10.5)).toMatch(/bilangan bulat/);
    expect(paymentProblem(100_000, 0, 'abc')).toMatch(/bilangan bulat/);
    expect(paymentProblem(100_000, 100_000, 1)).toMatch(/sudah lunas/);
  });
});
