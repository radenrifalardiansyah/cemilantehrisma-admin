import { describe, it, expect } from 'vitest';
import { ownerSalaryForPeriod, breakEvenOmzet, marginHistory, previousMonths } from './business-health';

describe('ownerSalaryForPeriod', () => {
  it('satu bulan penuh = gaji bulanan', () => {
    expect(ownerSalaryForPeriod(3_000_000, '2026-11-01', '2026-11-30')).toBe(3_000_000);
    expect(ownerSalaryForPeriod(3_100_000, '2026-12-01', '2026-12-31')).toBe(3_100_000);
  });
  it('sebagian bulan dibagi rata per hari', () => {
    expect(ownerSalaryForPeriod(3_000_000, '2026-11-01', '2026-11-10')).toBe(1_000_000);
    expect(ownerSalaryForPeriod(3_000_000, '2026-11-05', '2026-11-05')).toBe(100_000);
  });
  it('lintas bulan dan setahun penuh', () => {
    expect(ownerSalaryForPeriod(3_000_000, '2026-01-01', '2026-12-31')).toBe(36_000_000);
    expect(ownerSalaryForPeriod(3_000_000, '2026-10-31', '2026-11-01')).toBe(Math.round(3_000_000 / 31 + 3_000_000 / 30));
  });
  it('nol/negatif/rentang terbalik = 0', () => {
    expect(ownerSalaryForPeriod(0, '2026-11-01', '2026-11-30')).toBe(0);
    expect(ownerSalaryForPeriod(-5, '2026-11-01', '2026-11-30')).toBe(0);
    expect(ownerSalaryForPeriod(3_000_000, '2026-11-30', '2026-11-01')).toBe(0);
  });
});

describe('breakEvenOmzet', () => {
  it('biaya tetap dibagi margin kotor', () => {
    expect(breakEvenOmzet(4_000_000, 10_000_000, 5_000_000)).toBe(8_000_000);
  });
  it('tanpa omzet atau margin kotor <= 0: tidak ada titik impas', () => {
    expect(breakEvenOmzet(1, 0, 0)).toBeNull();
    expect(breakEvenOmzet(1, 1000, 0)).toBeNull();
    expect(breakEvenOmzet(1, 1000, -50)).toBeNull();
  });
});

describe('marginHistory & previousMonths', () => {
  it('margin setelah gaji dan rata-rata ditimbang omzet, bulan kosong diabaikan', () => {
    const h = marginHistory([
      { month: '2026-08', pendapatan: 10_000_000, labaBersih: 2_000_000 },
      { month: '2026-09', pendapatan: 0, labaBersih: 0 },
      { month: '2026-10', pendapatan: 20_000_000, labaBersih: 3_000_000 },
    ], 1_000_000);
    expect(h.months.map(m => m.month)).toEqual(['2026-08', '2026-10']);
    expect(h.months[0].marginPct).toBeCloseTo(10);
    expect(h.months[1].marginPct).toBeCloseTo(10);
    expect(h.avgMarginPct).toBeCloseTo(10);
  });
  it('tanpa omzet sama sekali: rata-rata null', () => {
    expect(marginHistory([{ month: '2026-08', pendapatan: 0, labaBersih: 0 }], 0).avgMarginPct).toBeNull();
  });
  it('previousMonths lintas tahun', () => {
    expect(previousMonths('2026-02-01', 3)).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(previousMonths('2026-11-15', 2)).toEqual(['2026-09', '2026-10']);
  });
});
