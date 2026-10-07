import { describe, expect, it } from 'vitest';
import { summarizePo, summarizeGr, summarizeOpname, type PoReportRow, type GrReportRow, type OpnameReportRow } from './procurement-report';

const po = (o: Partial<PoReportRow>): PoReportRow => ({ id: 'x', poNumber: 'PO', date: '2026-10-01', supplierName: 'A', items: '', total: 100, status: 'terkirim', expectedDate: null, receivedValue: 0, late: false, ...o });
const gr = (o: Partial<GrReportRow>): GrReportRow => ({ id: 'x', grNumber: 'GR', doNumber: 'DO', poNumber: 'PO', supplierName: 'A', receivedDate: '2026-10-01', items: '', total: 100, status: 'approved', approvedBy: 'u', paymentStatus: 'lunas', purchaseVoided: false, ...o });
const op = (o: Partial<OpnameReportRow>): OpnameReportRow => ({ id: 'x', createdAt: '2026-10-01T00:00:00Z', warehouseName: 'G1', productName: 'P', delta: 1, unitCost: 1000, value: 1000, note: '', ...o });

describe('summarizePo', () => {
  it('nilai PO tidak menghitung yang batal; belum diterima = nilai - diterima', () => {
    const s = summarizePo([po({ total: 1000, receivedValue: 400 }), po({ total: 500, status: 'batal' }), po({ total: 200, status: 'diterima', receivedValue: 200 })]);
    expect(s.count).toBe(3);
    expect(s.totalValue).toBe(1200);
    expect(s.receivedValue).toBe(600);
    expect(s.outstandingValue).toBe(600);
    expect(s.byStatus).toEqual({ terkirim: 1, batal: 1, diterima: 1 });
  });
  it('nilai diterima dibatasi nilai PO dan terlambat dihitung', () => {
    const s = summarizePo([po({ total: 100, receivedValue: 150 }), po({ late: true })]);
    expect(s.receivedValue).toBe(100);
    expect(s.lateCount).toBe(1);
  });
  it('rincian per supplier diurutkan dari nilai terbesar', () => {
    const s = summarizePo([po({ supplierName: 'A', total: 100 }), po({ supplierName: 'B', total: 300 }), po({ supplierName: 'A', total: 50 })]);
    expect(s.bySupplier.map(b => [b.name, b.count, b.total])).toEqual([['B', 1, 300], ['A', 2, 150]]);
  });
});

describe('summarizeGr', () => {
  it('hanya GR approved (dan pembeliannya tidak void) yang masuk nilai diterima', () => {
    const s = summarizeGr([gr({ total: 100 }), gr({ total: 50, status: 'draft' }), gr({ total: 70, status: 'dibatalkan' }), gr({ total: 30, purchaseVoided: true })]);
    expect(s.approvedValue).toBe(100);
    expect(s.pendingValue).toBe(50);
  });
  it('belum lunas dihitung dari GR approved', () => {
    expect(summarizeGr([gr({ total: 100, paymentStatus: 'belum_lunas' }), gr({ total: 40 })]).unpaidValue).toBe(100);
  });
});

describe('summarizeOpname', () => {
  it('memisahkan lebih/kurang dan menghitung selisih bersih', () => {
    const s = summarizeOpname([op({ delta: 5, value: 5000 }), op({ delta: -2, value: -2000 }), op({ delta: -1, value: -500, warehouseName: 'G2' })]);
    expect(s.gain).toBe(5000);
    expect(s.loss).toBe(2500);
    expect(s.net).toBe(2500);
    expect(s.unitsOver).toBe(5);
    expect(s.unitsShort).toBe(3);
    expect(s.byWarehouse.map(w => [w.name, w.total])).toEqual([['G2', -500], ['G1', 3000]]);
  });
});
