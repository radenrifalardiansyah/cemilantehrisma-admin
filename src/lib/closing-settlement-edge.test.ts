import { describe, expect, it } from 'vitest';
import { allocationProblem, diffLinks, parseLinks, settlementRemaining, settlementStatus, transferAmountProblem, type ClosingForLink } from './closing-settlement-core';

// Kasus tepi tambahan (desimal numeric, toleransi Rp1, HPP 0) untuk status transfer closing.
const base = { status: 'aktif', isOpeningBalance: false };
const cl = (over: Partial<ClosingForLink> = {}): Map<string, ClosingForLink> =>
  new Map([['c1', { id: 'c1', status: 'aktif', isOpeningBalance: false, totalCogs: 1000, settledByOthers: 0, periodTo: '2026-11-13', ...over }]]);

describe('settlementStatus: batas toleransi dengan desimal', () => {
  it('selisih tepat Rp1 = sudah walau HPP berdesimal (1024.42 - 1 = 1023.42)', () => {
    // 1024.42 - 1 menghasilkan 1023.4200000000001 di floating point, sehingga 1023.42 salah dianggap "sebagian".
    expect(settlementStatus({ ...base, totalCogs: 1024.42 }, 1023.42)).toBe('sudah');
    expect(settlementStatus({ ...base, totalCogs: 16384.97 }, 16383.97)).toBe('sudah');
  });
  it('cicilan desimal yang jumlahnya tepat HPP-1 = sudah (akumulasi floating point)', () => {
    const cogs = 5000.39;
    const settledAtBoundary = 2499.69 + 2499.7; // 4999.39 = HPP - 1
    expect(settlementStatus({ ...base, totalCogs: cogs }, settledAtBoundary)).toBe('sudah');
  });
  it('selisih Rp1,01 = sebagian', () => {
    expect(settlementStatus({ ...base, totalCogs: 1000 }, 998.99)).toBe('sebagian');
  });
});

describe('settlementStatus: HPP 0', () => {
  it('closing ber-HPP 0 tidak boleh tampil "Belum ditransfer" (tidak ada yang bisa ditransfer; pemilih /closings/payable juga mengecualikannya)', () => {
    expect(settlementStatus({ ...base, totalCogs: 0 }, 0)).not.toBe('belum');
  });
});

describe('allocationProblem: desimal', () => {
  it('menerima tautan = sisa HPP berdesimal persis, menolak lebih dari 1 sen di atasnya', () => {
    const closings = cl({ totalCogs: 12345.67, settledByOthers: 0.67 });
    expect(allocationProblem({ links: [{ closingId: 'c1', amount: 12345 }], transferAmount: 12345, closings })).toBeNull();
    expect(allocationProblem({ links: [{ closingId: 'c1', amount: 12345.02 }], transferAmount: 20000, closings })).not.toBeNull();
  });
  it('closing dengan total_cogs null ditolak; transfer dibulatkan 2 desimal tidak memicu galat', () => {
    expect(allocationProblem({ links: [{ closingId: 'c1', amount: 10 }], transferAmount: 10, closings: cl({ totalCogs: null }) })).not.toBeNull();
    expect(allocationProblem({ links: [{ closingId: 'c1', amount: 0.1 + 0.2 }], transferAmount: 0.3, closings: cl() })).toBeNull();
  });
  it('dua tautan ke closing berbeda: total dihitung gabungan terhadap jumlah transfer', () => {
    const closings = cl();
    closings.set('c2', { id: 'c2', status: 'aktif', isOpeningBalance: false, totalCogs: 500, settledByOthers: 0, periodTo: '2026-11-14' });
    expect(allocationProblem({ links: [{ closingId: 'c1', amount: 600 }, { closingId: 'c2', amount: 400 }], transferAmount: 1000, closings })).toBeNull();
    expect(allocationProblem({ links: [{ closingId: 'c1', amount: 600 }, { closingId: 'c2', amount: 400.01 }], transferAmount: 1000, closings })).not.toBeNull();
  });
});

describe('parseLinks: input berbahaya', () => {
  it('nominal string numerik diterima, objek/array/NaN/Infinity ditolak', () => {
    expect(parseLinks([{ closingId: 'a', amount: '1500' }])).toEqual({ links: [{ closingId: 'a', amount: 1500 }] });
    for (const amount of [NaN, Infinity, -Infinity, [], {}, true, 1e30]) {
      expect('error' in parseLinks([{ closingId: 'a', amount }])).toBe(true);
    }
  });
  it('daftar kosong sah (artinya: lepas semua)', () => {
    expect(parseLinks([])).toEqual({ links: [] });
  });
});

describe('transferAmountProblem & diffLinks', () => {
  it('jumlah sama dengan total tautan boleh; kurang sedikit (>0,005) ditolak', () => {
    expect(transferAmountProblem(1000, 1000)).toBeNull();
    expect(transferAmountProblem(999.99, 1000)).not.toBeNull();
  });
  it('diffLinks: set sama = kosong; nominal sama dalam toleransi 0,005 dianggap tidak berubah', () => {
    const l = [{ closingId: 'a', amount: 10 }];
    expect(diffLinks(l, l)).toEqual({ added: [], changed: [], removed: [] });
    expect(diffLinks(l, [{ closingId: 'a', amount: 10.004 }]).changed).toHaveLength(0);
  });
  it('settlementRemaining membulatkan 2 desimal', () => {
    expect(settlementRemaining(100.3, 100.1)).toBe(0.2);
  });
});
