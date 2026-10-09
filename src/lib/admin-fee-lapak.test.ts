import { describe, it, expect } from 'vitest';
import { buildLapakFeeSource, computeFee, type AdminFeeRate } from './admin-fee';

const rate = (type: AdminFeeRate['type'], value: number, from: string): AdminFeeRate => ({
  id: `${type}-${from}`, channel: 'lapak', type, value, effectiveFrom: new Date(`${from}T00:00:00+07:00`), createdAt: new Date(), createdBy: 'uji',
});
const sale = (id: string, total: number, at: string) => ({ id, label: id, total, createdAt: new Date(at) });

describe('computeFee', () => {
  it('tarif bulanan tidak dikenakan per transaksi', () => {
    expect(computeFee(100000, rate('monthly', 150000, '2026-01-01'))).toBe(0);
    expect(computeFee(100000, rate('percent', 3, '2026-01-01'))).toBe(3000);
    expect(computeFee(100000, rate('fixed', 2000, '2026-01-01'))).toBe(2000);
  });
});

describe('buildLapakFeeSource', () => {
  it('per transaksi (persen): fee tiap penjualan, tanpa baris bulanan', () => {
    const out = buildLapakFeeSource([sale('a', 50000, '2026-10-05T03:00:00Z'), sale('b', 10000, '2026-10-06T03:00:00Z')], [rate('percent', 5, '2026-01-01')]);
    expect(out.map(i => i.fee)).toEqual([2500, 500]);
    expect(out.some(i => i.id.startsWith('lapak-month:'))).toBe(false);
  });

  it('bulanan: satu baris per bulan yang ada penjualan, penjualannya sendiri tanpa fee dan omzet tidak dobel', () => {
    const out = buildLapakFeeSource(
      [sale('a', 50000, '2026-10-05T03:00:00Z'), sale('b', 10000, '2026-10-20T03:00:00Z'), sale('c', 20000, '2026-11-02T03:00:00Z')],
      [rate('monthly', 150000, '2026-01-01')],
    );
    expect(out.filter(i => !i.id.startsWith('lapak-month:')).every(i => i.fee === 0)).toBe(true);
    const months = out.filter(i => i.id.startsWith('lapak-month:'));
    expect(months.map(m => [m.id, m.fee, m.revenue])).toEqual([['lapak-month:2026-10', 150000, 0], ['lapak-month:2026-11', 150000, 0]]);
    expect(months[0].label).toContain('Oktober 2026');
  });

  it('bulan tanpa penjualan tidak ditagih', () => {
    expect(buildLapakFeeSource([], [rate('monthly', 150000, '2026-01-01')])).toEqual([]);
  });

  it('tarif berganti di tengah: sebelum tanggal efektif persen, sesudahnya bulanan', () => {
    const out = buildLapakFeeSource(
      [sale('lama', 100000, '2026-09-10T03:00:00Z'), sale('baru', 100000, '2026-10-10T03:00:00Z')],
      [rate('percent', 2, '2026-01-01'), rate('monthly', 100000, '2026-10-01')],
    );
    expect(out.find(i => i.id === 'lama')!.fee).toBe(2000);
    expect(out.find(i => i.id === 'baru')!.fee).toBe(0);
    expect(out.find(i => i.id === 'lapak-month:2026-10')!.fee).toBe(100000);
    expect(out.some(i => i.id === 'lapak-month:2026-09')).toBe(false);
  });

  it('bulan dilihat dalam WIB: penjualan 31 Okt 23:30 WIB (= 16:30 UTC) masuk Oktober', () => {
    const out = buildLapakFeeSource([sale('x', 1000, '2026-10-31T16:30:00Z')], [rate('monthly', 1, '2026-01-01')]);
    expect(out.some(i => i.id === 'lapak-month:2026-10')).toBe(true);
    const out2 = buildLapakFeeSource([sale('y', 1000, '2026-10-31T17:30:00Z')], [rate('monthly', 1, '2026-01-01')]);
    expect(out2.some(i => i.id === 'lapak-month:2026-11')).toBe(true);
  });
});
