import { describe, expect, it } from 'vitest';
import {
  allocationProblem, closingPeriodLabel, diffLinks, parseLinks, settlementRemaining, settlementStatus, transferAmountProblem,
  type ClosingForLink,
} from './closing-settlement-core';
import { reopenProblem } from './closing';

const base = { status: 'aktif', isOpeningBalance: false };

describe('settlementStatus (toleransi Rp 1)', () => {
  it('0 tertaut = belum; sebagian; >= HPP-1 = sudah', () => {
    const c = { ...base, totalCogs: 118_750 };
    expect(settlementStatus(c, 0)).toBe('belum');
    expect(settlementStatus(c, 50_000)).toBe('sebagian');
    expect(settlementStatus(c, 118_748)).toBe('sebagian'); // selisih 2 > Rp1
    expect(settlementStatus(c, 118_749)).toBe('sudah');    // selisih tepat Rp1 dianggap lunas
    expect(settlementStatus(c, 118_750)).toBe('sudah');
  });
  it('saldo awal, total_cogs null, dan dibuka ulang tidak punya status', () => {
    expect(settlementStatus({ ...base, totalCogs: null }, 0)).toBeNull();
    expect(settlementStatus({ status: 'aktif', isOpeningBalance: true, totalCogs: 1000 }, 0)).toBeNull();
    expect(settlementStatus({ status: 'dibuka_ulang', isOpeningBalance: false, totalCogs: 1000 }, 0)).toBeNull();
  });
  it('sisa tidak pernah negatif', () => {
    expect(settlementRemaining(1000, 400)).toBe(600);
    expect(settlementRemaining(1000, 1200)).toBe(0);
  });
});

describe('parseLinks', () => {
  it('menerima daftar sah, menolak dobel/nominal 0/bukan array', () => {
    expect(parseLinks([{ closingId: 'a', amount: 100 }, { closingId: 'b', amount: '50' }])).toEqual({ links: [{ closingId: 'a', amount: 100 }, { closingId: 'b', amount: 50 }] });
    expect(parseLinks([{ closingId: 'a', amount: 1 }, { closingId: 'a', amount: 2 }])).toHaveProperty('error');
    expect(parseLinks([{ closingId: 'a', amount: 0 }])).toHaveProperty('error');
    expect(parseLinks([{ closingId: '', amount: 5 }])).toHaveProperty('error');
    expect(parseLinks('x')).toHaveProperty('error');
    expect(parseLinks([])).toEqual({ links: [] });
  });
});

describe('allocationProblem', () => {
  const c = (over: Partial<ClosingForLink> = {}): ClosingForLink => ({ id: 'c1', status: 'aktif', isOpeningBalance: false, totalCogs: 100_000, settledByOthers: 0, periodTo: '2026-11-13', ...over });
  const run = (links: { closingId: string; amount: number }[], transferAmount: number, cs: ClosingForLink[]) =>
    allocationProblem({ links, transferAmount, closings: new Map(cs.map(x => [x.id, x])) });

  it('lolos: pas HPP, dicicil, satu transfer menutup beberapa closing', () => {
    expect(run([{ closingId: 'c1', amount: 100_000 }], 100_000, [c()])).toBeNull();
    expect(run([{ closingId: 'c1', amount: 40_000 }], 100_000, [c({ settledByOthers: 60_000 })])).toBeNull();
    expect(run([{ closingId: 'c1', amount: 100_000 }, { closingId: 'c2', amount: 50_000 }], 150_000, [c(), c({ id: 'c2', totalCogs: 50_000 })])).toBeNull();
  });
  it('tolak: melebihi HPP closing (memperhitungkan transfer lain)', () => {
    expect(run([{ closingId: 'c1', amount: 100_001 }], 200_000, [c()])).toMatch(/melebihi HPP/);
    expect(run([{ closingId: 'c1', amount: 50_000 }], 200_000, [c({ settledByOthers: 60_000 })])).toMatch(/melebihi HPP/);
  });
  it('tolak: total tautan melebihi jumlah transfer', () => {
    expect(run([{ closingId: 'c1', amount: 60_000 }, { closingId: 'c2', amount: 50_000 }], 100_000, [c(), c({ id: 'c2' })])).toMatch(/melebihi jumlah transfer/);
  });
  it('tolak: closing saldo awal, dibuka ulang, tidak ada', () => {
    expect(run([{ closingId: 'c1', amount: 1 }], 10, [c({ isOpeningBalance: true })])).toMatch(/saldo awal/);
    expect(run([{ closingId: 'c1', amount: 1 }], 10, [c({ status: 'dibuka_ulang' })])).toMatch(/dibuka ulang/);
    expect(run([{ closingId: 'zz', amount: 1 }], 10, [c()])).toMatch(/tidak ditemukan/);
  });
});

describe('aturan edit transfer, buka ulang, label', () => {
  it('jumlah transfer tidak boleh turun di bawah total tautan', () => {
    expect(transferAmountProblem(100_000, 100_000)).toBeNull();
    expect(transferAmountProblem(150_000, 100_000)).toBeNull();
    expect(transferAmountProblem(99_999, 100_000)).toMatch(/tidak boleh kurang/);
    expect(transferAmountProblem(1, 0)).toBeNull();
  });
  it('buka ulang ditolak bila closing punya tautan transfer', () => {
    const closing = { id: 'c2', status: 'aktif', is_opening_balance: false, period_to: '2026-11-13' };
    const a = { closing, latestActiveId: 'c2', isSuperAdmin: false, reason: 'salah input' };
    expect(reopenProblem({ ...a, settlementCount: 1 })).toMatch(/Lepas tautan transfer dulu/);
    expect(reopenProblem({ ...a, settlementCount: 0 })).toBeNull();
    expect(reopenProblem(a)).toBeNull();
  });
  it('diffLinks: tambah, ubah, lepas', () => {
    const d = diffLinks([{ closingId: 'a', amount: 10 }, { closingId: 'b', amount: 20 }], [{ closingId: 'b', amount: 25 }, { closingId: 'c', amount: 5 }]);
    expect(d).toEqual({ added: [{ closingId: 'c', amount: 5 }], changed: [{ closingId: 'b', before: 20, after: 25 }], removed: [{ closingId: 'a', amount: 10 }] });
  });
  it('closingPeriodLabel', () => {
    expect(closingPeriodLabel('2026-11-12', '2026-11-13', 2026)).toBe('12–13 Nov');
    expect(closingPeriodLabel('2026-11-13', '2026-11-13', 2026)).toBe('13 Nov');
    expect(closingPeriodLabel(null, '2026-11-13', 2026)).toBe('13 Nov');
    expect(closingPeriodLabel('2026-10-30', '2026-11-02', 2026)).toBe('30 Okt–2 Nov');
    expect(closingPeriodLabel('2025-12-30', '2026-01-02', 2026)).toBe('30 Des 2025–2 Jan 2026');
    expect(closingPeriodLabel('2025-11-12', '2025-11-13', 2026)).toBe('12–13 Nov 2025');
  });
});
