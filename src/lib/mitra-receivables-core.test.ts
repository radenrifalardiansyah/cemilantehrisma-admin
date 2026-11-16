import { describe, expect, it } from 'vitest';
import {
  buildMitraPaymentExcelRows, buildReceivableExcelRows, buildReceivableItem, buildReceivableItems, filterMitraPayments, filterReceivables,
  groupReceivablesByMitra, mitraPaymentOptions, receivablesAlertMessage, summarizeMitraPayments, summarizeReceivables,
  type MitraPaymentRow, type ReceivableRawRow,
} from '@/lib/mitra-receivables-core';

// "Sekarang" tetap: 2026-11-16 12:00 WIB
const NOW = new Date('2026-11-16T05:00:00Z');
const raw = (o: Partial<ReceivableRawRow> = {}): ReceivableRawRow => ({
  recapId: 'r1', locationId: 'l1', locationName: 'Mitra A', date: '2026-11-10', total: 100_000, paid: 0, dueDate: null, walletId: null, ...o,
});

describe('buildReceivableItem', () => {
  it('sebagian memakai sisa (total - dibayar) dan state sebagian', () => {
    const it = buildReceivableItem(raw({ paid: 40_000 }), NOW)!;
    expect(it.remaining).toBe(60_000);
    expect(it.state).toBe('sebagian');
  });
  it('0 dibayar = belum_lunas; umur dari tanggal rekap (WIB)', () => {
    const it = buildReceivableItem(raw({ date: '2026-11-09' }), NOW)!;
    expect(it.state).toBe('belum_lunas');
    expect(it.ageDays).toBe(7);
  });
  it('umur tidak negatif (tanggal rekap di depan)', () => {
    expect(buildReceivableItem(raw({ date: '2026-11-20' }), NOW)!.ageDays).toBe(0);
  });
  it('toleransi: sisa <= Rp1 dianggap lunas (tidak ikut piutang); Rp2 masih ikut', () => {
    expect(buildReceivableItem(raw({ paid: 99_999 }), NOW)).toBeNull();
    expect(buildReceivableItem(raw({ paid: 100_000 }), NOW)).toBeNull();
    expect(buildReceivableItem(raw({ paid: 99_998 }), NOW)!.remaining).toBe(2);
  });
  it('jatuh tempo: lewat, hari ini, segera, nanti, tanpa', () => {
    const st = (dueDate: string | null) => buildReceivableItem(raw({ dueDate }), NOW)!;
    expect(st('2026-11-14')).toMatchObject({ dueStatus: 'overdue', dueDays: 2 });
    expect(st('2026-11-16').dueStatus).toBe('today');
    expect(st('2026-11-19')).toMatchObject({ dueStatus: 'soon', dueDays: 3 });
    expect(st('2026-11-20').dueStatus).toBe('later');
    expect(st(null).dueStatus).toBe('none');
  });
  it('rekap lama lunas (sisa 0) tak ikut', () => {
    expect(buildReceivableItems([raw({ recapId: 'a', paid: 100_000 }), raw({ recapId: 'b' })], NOW).map(r => r.recapId)).toEqual(['b']);
  });
});

describe('agregasi per mitra & ringkasan', () => {
  const items = buildReceivableItems([
    raw({ recapId: 'a', date: '2026-11-15', total: 100_000, paid: 30_000, dueDate: '2026-11-14' }),             // lewat 2 hari, umur 1
    raw({ recapId: 'b', date: '2026-11-01', total: 50_000, dueDate: '2026-11-18' }),                           // segera, umur 15
    raw({ recapId: 'c', locationId: 'l2', locationName: 'Mitra B', date: '2026-09-01', total: 200_000, dueDate: '2026-12-31' }), // umur 76
    raw({ recapId: 'd', locationId: 'l2', locationName: 'Mitra B', date: '2026-11-10', total: 10_000 }),        // tanpa jatuh tempo
    raw({ recapId: 'e', locationId: 'l3', locationName: 'Mitra C', total: 5_000, paid: 5_000 }),               // lunas: tak ikut
  ], NOW);

  it('kelompok per mitra: total, jumlah, terdekat, lewat, tertua; urut terdesak', () => {
    const g = groupReceivablesByMitra(items);
    expect(g.map(x => x.locationId)).toEqual(['l1', 'l2']);
    expect(g[0]).toMatchObject({ totalReceivable: 120_000, recapCount: 2, nearestDue: '2026-11-14', overdueCount: 1, overdueAmount: 70_000, oldestDays: 15 });
    expect(g[0].items.map(i => i.recapId)).toEqual(['a', 'b']);
    expect(g[1]).toMatchObject({ totalReceivable: 210_000, recapCount: 2, nearestDue: '2026-12-31', overdueCount: 0, oldestDays: 76 });
    expect(g[1].items.map(i => i.recapId)).toEqual(['c', 'd']); // tanpa jatuh tempo paling akhir
  });

  it('ringkasan: total, mitra, rekap, lewat, peringatan, aging (tiap rekap satu kelompok)', () => {
    const s = summarizeReceivables(items);
    expect(s).toMatchObject({ totalReceivable: 330_000, mitraCount: 2, recapCount: 4, overdueCount: 1, overdueAmount: 70_000, alertCount: 2, alertAmount: 120_000 });
    expect(s.aging.b0_7).toEqual({ count: 2, amount: 80_000 }); // termasuk rekap tanpa jatuh tempo (umur menentukan, bukan jatuh tempo)
    expect(s.aging.b8_30).toEqual({ count: 1, amount: 50_000 });
    expect(s.aging.b31_plus).toEqual({ count: 1, amount: 200_000 });
    const sum = Object.values(s.aging).reduce((a, b) => a + b.amount, 0);
    expect(sum).toBe(s.totalReceivable);
  });

  it('batas aging: 7 hari = b0_7, 8 = b8_30, 30 = b8_30, 31 = b31_plus', () => {
    const at = (days: number) => {
      const d = new Date(Date.UTC(2026, 10, 16) - days * 86_400_000).toISOString().slice(0, 10);
      return buildReceivableItem(raw({ date: d, dueDate: '2026-12-31' }), NOW)!;
    };
    const a = summarizeReceivables([at(7), at(8), at(30), at(31)]).aging;
    expect([a.b0_7.count, a.b8_30.count, a.b31_plus.count]).toEqual([1, 2, 1]);
  });

  it('kosong', () => {
    const s = summarizeReceivables([]);
    expect(s.totalReceivable).toBe(0);
    expect(s.mitraCount).toBe(0);
    expect(groupReceivablesByMitra([])).toEqual([]);
    expect(receivablesAlertMessage(s)).toBeNull();
  });

  it('pesan peringatan', () => {
    expect(receivablesAlertMessage(summarizeReceivables(items))).toBe('1 rekap lewat jatuh tempo, 1 rekap jatuh tempo dalam 3 hari — total sisa Rp120.000.');
  });

  it('filter jatuh tempo & cari mitra', () => {
    expect(filterReceivables(items, { due: 'overdue' }).map(i => i.recapId)).toEqual(['a']);
    expect(filterReceivables(items, { due: 'soon' }).map(i => i.recapId)).toEqual(['b']);
    expect(filterReceivables(items, { search: ' mitra b' }).map(i => i.recapId)).toEqual(['c', 'd']);
    expect(filterReceivables(items, {})).toHaveLength(4);
  });

  it('Excel: baris sesuai filter + total sisa', () => {
    const { body, total } = buildReceivableExcelRows(items.filter(i => i.locationId === 'l1'), d => `f:${d}`);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual([1, 'Mitra A', 'f:2026-11-15', 100_000, 30_000, 'Sebagian', 'f:2026-11-14', 1, 70_000]);
    expect(body[1][5]).toBe('Belum Lunas');
    expect(total[1]).toBe('TOTAL (2 rekap, 1 mitra)');
    expect(total[8]).toBe(120_000);
  });
});

describe('riwayat pembayaran', () => {
  const pay = (o: Partial<MitraPaymentRow> = {}): MitraPaymentRow => ({
    id: 'p1', recapId: 'r1', locationId: 'l1', locationName: 'Mitra A', date: '2026-11-10', amount: 100_000, walletId: 'kas', walletName: 'Kas',
    note: '', createdBy: 'rifal', voided: false, recapDate: '2026-11-01', recapTotal: 300_000, createdAt: '2026-11-10T01:00:00.000Z', ...o,
  });
  it('ringkasan menjumlah yang aktif; void terpisah; mitra unik', () => {
    const s = summarizeMitraPayments([
      pay({ id: 'a', amount: 100_000 }), pay({ id: 'b', amount: 50_000.5 }), pay({ id: 'c', locationId: 'l2', amount: 70_000 }),
      pay({ id: 'd', locationId: 'l9', amount: 999, voided: true }),
    ]);
    expect(s).toEqual({ count: 3, totalPaid: 220_000.5, mitraCount: 2, voidedCount: 1 });
    expect(summarizeMitraPayments([])).toEqual({ count: 0, totalPaid: 0, mitraCount: 0, voidedCount: 0 });
  });
  it('filter mitra/kata kunci dan opsi mitra', () => {
    const rows = [pay({ id: 'a', note: 'Termin 1' }), pay({ id: 'b', locationId: 'l2', locationName: 'Kafe B', walletName: 'BCA' })];
    expect(filterMitraPayments(rows, { locationId: 'l2' }).map(r => r.id)).toEqual(['b']);
    expect(filterMitraPayments(rows, { search: 'TERMIN' }).map(r => r.id)).toEqual(['a']);
    expect(filterMitraPayments(rows, { search: 'bca' }).map(r => r.id)).toEqual(['b']);
    expect(filterMitraPayments(rows, {})).toHaveLength(2);
    expect(mitraPaymentOptions([...rows, pay({ id: 'c' })]).map(o => o.name)).toEqual(['Kafe B', 'Mitra A']);
  });
  it('Excel: total tidak menghitung yang dibatalkan', () => {
    const { body, total } = buildMitraPaymentExcelRows([pay({ amount: 100 }), pay({ id: 'x', amount: 40, voided: true })], d => `f:${d}`);
    expect(body[0]).toEqual([1, 'f:2026-11-10', 'Mitra A', 'f:2026-11-01', 'Kas', '-', 'rifal', 'Aktif', 100]);
    expect(body[1][7]).toBe('Dibatalkan');
    expect(total[7]).toBe('TOTAL (1 pembayaran)');
    expect(total[8]).toBe(100);
  });
});
