import { describe, expect, it } from 'vitest';
import { addDaysWib, dueInfo, isValidDueDate } from './receivable';

// 12.00 WIB pada 6 Okt 2026 (UTC 05.00)
const NOW = new Date('2026-10-06T05:00:00Z');

describe('dueInfo', () => {
  it('upcoming / today / overdue berdasarkan hari kalender WIB', () => {
    expect(dueInfo('2026-10-10', NOW)).toEqual({ state: 'upcoming', days: 4 });
    expect(dueInfo('2026-10-06', NOW)).toEqual({ state: 'today', days: 0 });
    expect(dueInfo('2026-10-03', NOW)).toEqual({ state: 'overdue', days: 3 });
  });
  it('lewat tengah malam WIB (UTC masih hari sebelumnya) dihitung hari WIB', () => {
    const lateNight = new Date('2026-10-06T18:00:00Z'); // 01.00 WIB 7 Okt
    expect(dueInfo('2026-10-06', lateNight)).toEqual({ state: 'overdue', days: 1 });
  });
  it('kosong/tidak valid → null', () => {
    expect(dueInfo(undefined, NOW)).toBeNull();
    expect(dueInfo('besok', NOW)).toBeNull();
  });
});

describe('addDaysWib & isValidDueDate', () => {
  it('menambah hari dari tanggal WIB', () => {
    expect(addDaysWib(14, NOW)).toBe('2026-10-20');
    expect(addDaysWib(0, NOW)).toBe('2026-10-06');
  });
  it('validasi format tanggal', () => {
    expect(isValidDueDate('2026-10-20')).toBe(true);
    expect(isValidDueDate('2026-13-45')).toBe(false);
    expect(isValidDueDate('20-10-2026')).toBe(false);
    expect(isValidDueDate(123)).toBe(false);
  });
});
