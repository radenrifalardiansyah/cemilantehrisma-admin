import { describe, expect, it } from 'vitest';
import { closingToPdfData, draftToPdfData, PDF_MAX_LINES, type ClosingRecord } from './closing-pdf-data';
import type { ClosingLine } from '@/lib/closing';

const line = (i: number, over: Partial<ClosingLine> = {}): ClosingLine => ({
  key: `order:${i}`, kind: 'order', orderId: `o${i}`, invoiceNo: `INV-${i}`, party: 'Budi', txDate: '2026-11-10', paidDate: '2026-11-11',
  qty: 2, cogs: 2_000, revenue: 5_000, ...over,
});

const closing = (over: Partial<ClosingRecord> = {}): ClosingRecord => ({
  id: 'abcdef12-0000-0000-0000-000000000000', period_from: '2026-11-01', period_to: '2026-11-11',
  closed_at: new Date('2026-11-12T03:00:00Z'), closed_by: 'rifal', total_qty: '6', total_cogs: '6000', total_revenue: '15000',
  item_count: 3, note: 'Closing harian', status: 'aktif', reopened_at: null, reopened_by: null, reopen_reason: null, is_opening_balance: false,
  ...over,
});

describe('closingToPdfData', () => {
  it('closing aktif: meta, ringkasan snapshot, rincian bernomor, tanpa catatan selisih bila cocok', () => {
    const d = closingToPdfData(closing(), [line(1), line(2), line(3)]);
    expect(d.variant).toBe('closing');
    expect(d.title).toBe('LAPORAN CLOSING HPP');
    expect(d.meta.find(m => m.label === 'Ditutup Oleh')?.value).toBe('rifal');
    expect(d.meta.find(m => m.label === 'Status')?.value).toBe('Aktif');
    expect(d.meta.find(m => m.label === 'Waktu Closing')?.value).toContain('WIB');
    expect(d.meta.find(m => m.label === 'Waktu Closing')?.value).toContain('10.00'); // 03:00Z = 10:00 WIB
    expect(d.meta.find(m => m.label === 'Catatan')?.value).toBe('Closing harian');
    expect(d.summary[0]).toEqual({ label: 'Jumlah Transaksi', value: '3' });
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].lines.map(l => l.no)).toEqual([1, 2, 3]);
    expect(d.sections[0].totals).toEqual({ count: 3, qty: 6, cogs: 6000, revenue: 15000 });
    expect(d.notes).toEqual([]);
    expect(d.notice).toBeUndefined();
  });

  it('selisih rincian vs snapshot: total resmi = snapshot + catatan kaki', () => {
    const d = closingToPdfData(closing({ total_cogs: '6001' }), [line(1), line(2), line(3)]);
    expect(d.sections[0].totals.cogs).toBe(6001);
    expect(d.notes).toHaveLength(1);
    expect(d.notes[0]).toContain('snapshot');
  });

  it('dibuka ulang: status, alasan, dan penjelasan rincian tidak tersedia', () => {
    const d = closingToPdfData(closing({ status: 'dibuka_ulang', reopened_by: 'admin', reopened_at: new Date('2026-11-13T00:00:00Z'), reopen_reason: 'Salah qty' }), []);
    expect(d.meta.find(m => m.label === 'Status')?.value).toBe('Dibuka ulang');
    expect(d.meta.find(m => m.label === 'Alasan Buka Ulang')?.value).toBe('Salah qty');
    expect(d.sections).toEqual([]);
    expect(d.notice).toContain('dibuka ulang');
    expect(d.summary[2].value).toContain('6.000'); // snapshot tetap ditampilkan
  });

  it('saldo awal: hanya jumlah item, tanpa total/rincian nominal', () => {
    const d = closingToPdfData(closing({ is_opening_balance: true, total_qty: null, total_cogs: null, total_revenue: null, item_count: 42, period_from: null }), [line(1)]);
    expect(d.variant).toBe('opening');
    expect(d.sections).toEqual([]);
    expect(d.summary).toEqual([{ label: 'Jumlah Item', value: '42' }]);
    expect(d.periodText).toContain('Saldo awal sampai');
    expect(d.notice).toContain('42 item');
  });

  it('membatasi rincian ke PDF_MAX_LINES tetapi total tetap penuh', () => {
    const many = Array.from({ length: PDF_MAX_LINES + 5 }, (_, i) => line(i));
    const d = closingToPdfData(closing({ item_count: many.length, total_qty: String(many.length * 2), total_cogs: String(many.length * 2000), total_revenue: String(many.length * 5000) }), many);
    expect(d.sections[0].lines).toHaveLength(PDF_MAX_LINES);
    expect(d.sections[0].omitted).toBe(5);
    expect(d.sections[0].totals.count).toBe(PDF_MAX_LINES + 5);
    expect(d.notes).toEqual([]);
  });

  it('urut tanggal bayar lalu tanggal transaksi', () => {
    const d = closingToPdfData(closing(), [line(1, { paidDate: '2026-11-11' }), line(2, { paidDate: '2026-11-09' }), line(3, { paidDate: '2026-11-11', txDate: '2026-11-01' })]);
    expect(d.sections[0].lines.map(l => l.invoice)).toEqual(['INV-2', 'INV-3', 'INV-1']);
  });
});

describe('draftToPdfData', () => {
  const recv = (i: number): ClosingLine => line(i, { paidDate: null, note: 'Sisa 50%' });
  it('menandai draf dan memisahkan sudah dibayar vs piutang, dengan total masing-masing', () => {
    const d = draftToPdfData({ upTo: '2026-11-12', today: '2026-11-12', lastClosingTo: null, paid: [line(1), line(2)], receivable: [recv(3)] });
    expect(d.variant).toBe('draft');
    expect(d.title).toContain('DRAF');
    expect(d.notice).toContain('BUKAN closing resmi');
    expect(d.sections.map(s => s.title)).toEqual(['A. Sudah dibayar, belum closing', 'B. Piutang (belum dibayar)']);
    expect(d.sections[0].totals).toEqual({ count: 2, qty: 4, cogs: 4000, revenue: 10000 });
    expect(d.sections[1].totals.count).toBe(1);
    expect(d.sections[1].lines[0].paidDate).toBeNull();
    expect(d.meta.find(m => m.label === 'Closing Terakhir')?.value).toBe('Belum ada closing aktif');
    expect(d.fileName).toBe('draf-closing-hpp-2026-11-12.pdf');
  });
  it('tanpa upTo: cakupan semua yang belum closing; bagian kosong tidak error', () => {
    const d = draftToPdfData({ upTo: null, today: '2026-11-12', lastClosingTo: '2026-11-05', paid: [], receivable: [] });
    expect(d.periodText).toContain('semua yang belum closing');
    expect(d.sections.every(s => s.lines.length === 0 && s.totals.count === 0)).toBe(true);
  });
});
