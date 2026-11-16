import { describe, expect, it } from 'vitest';
import {
  buildPaymentExcelRows, comparePaymentsNewestFirst, filterSupplierPayments, paymentDocLabel, paymentSupplierOptions,
  summarizeSupplierPayments, type SupplierPaymentRow,
} from '@/lib/supplier-payments-core';

const row = (o: Partial<SupplierPaymentRow> = {}): SupplierPaymentRow => ({
  id: 'x1', purchaseId: 'p1', date: '2026-11-10', amount: 100_000, supplierId: 's1', supplierName: 'Toko A', poNumber: 'PO-1', grNumber: null,
  walletId: 'kas', walletName: 'Kas', note: '', createdBy: 'rifal', voided: false, purchaseVoided: false, createdAt: '2026-11-10T01:00:00.000Z', ...o,
});

describe('summarizeSupplierPayments', () => {
  it('menjumlah hanya yang aktif; void dihitung terpisah; supplier unik', () => {
    const s = summarizeSupplierPayments([
      row({ id: 'a', amount: 100_000 }), row({ id: 'b', amount: 50_000.5 }),
      row({ id: 'c', amount: 70_000, supplierId: null, supplierName: ' Toko B ' }), row({ id: 'd', amount: 70_000, supplierId: null, supplierName: 'toko b' }),
      row({ id: 'e', amount: 999, voided: true, supplierId: 's9', supplierName: 'Hantu' }),
    ]);
    expect(s).toEqual({ count: 4, totalPaid: 290_000.5, supplierCount: 2, voidedCount: 1 });
  });
  it('kosong', () => expect(summarizeSupplierPayments([])).toEqual({ count: 0, totalPaid: 0, supplierCount: 0, voidedCount: 0 }));
});

describe('filter, urut, opsi', () => {
  const rows = [
    row({ id: 'a', note: 'Termin 1 tepung' }), row({ id: 'b', supplierId: 's2', supplierName: 'CV Maju', poNumber: null, grNumber: 'GR-9', walletName: 'BCA' }),
  ];
  it('filter supplier dan kata kunci (supplier/PO/GR/catatan/dompet)', () => {
    expect(filterSupplierPayments(rows, { supplierKey: 'id:s2' }).map(r => r.id)).toEqual(['b']);
    expect(filterSupplierPayments(rows, { search: 'gr-9' }).map(r => r.id)).toEqual(['b']);
    expect(filterSupplierPayments(rows, { search: 'TEPUNG' }).map(r => r.id)).toEqual(['a']);
    expect(filterSupplierPayments(rows, { search: 'bca' }).map(r => r.id)).toEqual(['b']);
    expect(filterSupplierPayments(rows, { search: 'tak ada' })).toEqual([]);
    expect(filterSupplierPayments(rows, {})).toHaveLength(2);
  });
  it('opsi supplier unik terurut nama', () => {
    expect(paymentSupplierOptions([...rows, row({ id: 'c' })]).map(o => o.name)).toEqual(['CV Maju', 'Toko A']);
  });
  it('urut terbaru: tanggal, lalu waktu catat', () => {
    const sorted = [row({ id: 'a', date: '2026-11-01' }), row({ id: 'b', date: '2026-11-05', createdAt: '2026-11-05T01:00:00Z' }), row({ id: 'c', date: '2026-11-05', createdAt: '2026-11-05T09:00:00Z' })].sort(comparePaymentsNewestFirst);
    expect(sorted.map(r => r.id)).toEqual(['c', 'b', 'a']);
  });
  it('label dokumen', () => {
    expect(paymentDocLabel({ poNumber: 'PO-1', grNumber: 'GR-2' })).toBe('PO-1 · GR-2');
    expect(paymentDocLabel({ poNumber: null, grNumber: null })).toBe('Pembelian manual');
  });
});

describe('buildPaymentExcelRows', () => {
  it('baris sesuai filter + total tidak menghitung yang dibatalkan', () => {
    const { body, total } = buildPaymentExcelRows([row({ id: 'a', amount: 100 }), row({ id: 'b', amount: 40, voided: true, note: 'x' })], d => `fmt:${d}`);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual([1, 'fmt:2026-11-10', 'Toko A', 'PO-1', 'Kas', '-', 'rifal', 'Aktif', 100]);
    expect(body[1][7]).toBe('Dibatalkan');
    expect(total[7]).toBe('TOTAL (1 pembayaran)');
    expect(total[8]).toBe(100);
  });
});
