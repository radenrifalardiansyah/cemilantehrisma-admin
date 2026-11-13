import { describe, expect, it } from 'vitest';
import {
  alertMessage, buildPayableRow, derivePaymentState, groupPayablesBySupplier, parseDueDate, payableDueStatus,
  purchasePaymentState, remainingOf, settlesPurchase, summarizePayables, validatePaymentAmount, PaymentError,
  type PayableRawRow,
} from './payables-core';

// 2026-11-13 12:00 WIB
const NOW = new Date('2026-11-13T05:00:00Z');
const raw = (o: Partial<PayableRawRow> = {}): PayableRawRow => ({
  id: 'p1', supplierId: 's1', supplierName: 'Toko A', poNumber: 'PO-1', grNumber: 'GR-1',
  date: '2026-11-01', total: 1_000_000, paid: 0, dueDate: null, walletId: 'w1', ...o,
});
const row = (o: Partial<PayableRawRow> = {}) => buildPayableRow(raw(o), NOW)!;

describe('status turunan', () => {
  it('0 dibayar = belum_lunas, sebagian, lunas', () => {
    expect(derivePaymentState(1000, 0)).toBe('belum_lunas');
    expect(derivePaymentState(1000, 400)).toBe('sebagian');
    expect(derivePaymentState(1000, 1000)).toBe('lunas');
  });
  it('toleransi Rp 1', () => {
    expect(derivePaymentState(1000, 999)).toBe('lunas');
    expect(derivePaymentState(1000, 998.99)).toBe('sebagian');
    expect(settlesPurchase(1000, 999)).toBe(true);
    expect(settlesPurchase(1000, 998)).toBe(false);
  });
  it('kolom lunas menang (pembelian lunas lama tanpa pembayaran); void = null', () => {
    expect(purchasePaymentState({ paymentStatus: 'lunas', total: 500, paid: 0, voided: false })).toBe('lunas');
    expect(purchasePaymentState({ paymentStatus: 'belum_lunas', total: 500, paid: 100, voided: false })).toBe('sebagian');
    expect(purchasePaymentState({ paymentStatus: 'belum_lunas', total: 500, paid: 0, voided: true })).toBeNull();
  });
  it('sisa tidak pernah negatif', () => { expect(remainingOf(100, 130)).toBe(0); });
});

describe('validatePaymentAmount', () => {
  it('menerima nominal sampai sisa', () => { expect(validatePaymentAmount(600, 600)).toBe(600); expect(validatePaymentAmount('250.5', 600)).toBe(250.5); });
  it('menolak nol, negatif, bukan angka, dan melebihi sisa', () => {
    for (const bad of [0, -5, 'abc', null, NaN]) expect(() => validatePaymentAmount(bad, 600)).toThrow(PaymentError);
    expect(() => validatePaymentAmount(600.01, 600)).toThrow(/melebihi sisa/);
  });
});

describe('jatuh tempo', () => {
  it('menentukan lewat / hari ini / H-3 / nanti / kosong', () => {
    expect(payableDueStatus('2026-11-12', NOW)).toEqual({ status: 'overdue', days: 1 });
    expect(payableDueStatus('2026-11-13', NOW).status).toBe('today');
    expect(payableDueStatus('2026-11-16', NOW)).toEqual({ status: 'soon', days: 3 });
    expect(payableDueStatus('2026-11-17', NOW)).toEqual({ status: 'later', days: 4 });
    expect(payableDueStatus(null, NOW).status).toBe('none');
    expect(payableDueStatus('bukan-tanggal', NOW).status).toBe('none');
  });
  it('memakai hari WIB (23:30 UTC sudah esok hari di WIB)', () => {
    expect(payableDueStatus('2026-11-13', new Date('2026-11-13T17:30:00Z')).status).toBe('overdue');
  });
  it('parseDueDate', () => {
    expect(parseDueDate(undefined)).toBeUndefined();
    expect(parseDueDate(null)).toEqual({ value: null });
    expect(parseDueDate('')).toEqual({ value: null });
    expect(parseDueDate('2026-12-01')).toEqual({ value: '2026-12-01' });
    expect(parseDueDate('2026-13-45')).toHaveProperty('error');
    expect(parseDueDate('01/12/2026')).toHaveProperty('error');
  });
});

describe('buildPayableRow', () => {
  it('lunas / sisa <= toleransi tidak jadi hutang', () => {
    expect(buildPayableRow(raw({ paid: 1_000_000 }), NOW)).toBeNull();
    expect(buildPayableRow(raw({ paid: 999_999.5 }), NOW)).toBeNull();
  });
  it('menghitung sisa, status, dan jatuh tempo', () => {
    const r = row({ paid: 400_000, dueDate: '2026-11-10' });
    expect(r).toMatchObject({ remaining: 600_000, state: 'sebagian', dueStatus: 'overdue', dueDays: 3 });
  });
});

describe('rekap per supplier', () => {
  const rows = [
    row({ id: 'a1', supplierId: 's1', supplierName: 'Toko A', total: 1_000_000, paid: 400_000, dueDate: '2026-11-10' }), // 600k lewat
    row({ id: 'a2', supplierId: 's1', supplierName: 'Toko A', total: 200_000, dueDate: '2026-11-15' }),                  // 200k soon
    row({ id: 'a3', supplierId: 's1', supplierName: 'Toko A', total: 50_000 }),                                          // tanpa jatuh tempo
    row({ id: 'b1', supplierId: null, supplierName: ' Warung B ', total: 300_000, dueDate: '2026-12-30' }),              // nanti
    row({ id: 'b2', supplierId: null, supplierName: 'warung b', total: 100_000 }),
    row({ id: 'c1', supplierId: 's3', supplierName: 'Toko C', total: 70_000, dueDate: '2026-11-13' }),                   // hari ini
  ];

  it('mengelompokkan per supplier (id, atau nama tanpa id tak peka huruf besar) dan mengurutkan yang paling mendesak', () => {
    const g = groupPayablesBySupplier(rows);
    expect(g.map(x => x.supplierName)).toEqual(['Toko A', 'Toko C', 'Warung B']);
    const a = g[0];
    expect(a).toMatchObject({ totalDebt: 850_000, count: 3, nearestDue: '2026-11-10', overdueCount: 1, overdueAmount: 600_000 });
    expect(a.items.map(i => i.id)).toEqual(['a1', 'a2', 'a3']); // jatuh tempo terdekat dulu, kosong terakhir
    expect(g[2]).toMatchObject({ totalDebt: 400_000, count: 2, nearestDue: '2026-12-30', overdueCount: 0 });
  });

  it('ringkasan & peringatan menghitung lewat + hari ini + H-3 saja', () => {
    const s = summarizePayables(rows);
    expect(s).toMatchObject({ totalDebt: 1_320_000, supplierCount: 3, count: 6, overdueCount: 1, overdueAmount: 600_000, alertCount: 3, alertAmount: 870_000, alertSupplierCount: 2 });
    expect(alertMessage(s)).toBe('1 pembelian lewat jatuh tempo, 2 jatuh tempo dalam 3 hari — total sisa Rp870.000 ke 2 supplier.');
  });

  it('tanpa peringatan → null', () => {
    expect(alertMessage(summarizePayables([row({ dueDate: '2026-12-30' }), row({ id: 'x' })]))).toBeNull();
    expect(alertMessage(summarizePayables([]))).toBeNull();
  });
});
