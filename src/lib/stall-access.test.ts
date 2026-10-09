import { describe, it, expect } from 'vitest';
import { normalizeInvoicePrefix, hasAllStallAccess } from './stall-access';

describe('normalizeInvoicePrefix', () => {
  it('huruf besar, angka, tanda hubung; 2–12 karakter', () => {
    expect(normalizeInvoicePrefix(' lpk1 ')).toBe('LPK1');
    expect(normalizeInvoicePrefix('LPK-001')).toBe('LPK-001');
  });
  it('menolak terlalu pendek/panjang atau berisi simbol/spasi', () => {
    expect(normalizeInvoicePrefix('A')).toBeNull();
    expect(normalizeInvoicePrefix('ABCDEFGHIJKLM')).toBeNull();
    expect(normalizeInvoicePrefix('LPK 1')).toBeNull();
    expect(normalizeInvoicePrefix('LPK/1')).toBeNull();
    expect(normalizeInvoicePrefix(undefined)).toBeNull();
  });
});

describe('hasAllStallAccess', () => {
  it('hanya admin dan super-admin yang otomatis boleh semua lapak', () => {
    expect(hasAllStallAccess({ username: 'a', role: 'admin' })).toBe(true);
    expect(hasAllStallAccess({ username: 'a', role: 'super-admin' })).toBe(true);
    expect(hasAllStallAccess({ username: 'a', role: 'kasir-lapak' })).toBe(false);
    expect(hasAllStallAccess({ username: 'a', role: 'staff' })).toBe(false);
  });
});
