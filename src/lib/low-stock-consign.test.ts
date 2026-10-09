import { describe, it, expect } from 'vitest';
import { crossedLowStock } from './low-stock-consign';

describe('crossedLowStock', () => {
  it('hanya saat BARU melewati batas', () => {
    expect(crossedLowStock(6, 5, 5)).toBe(true);   // tepat menyentuh batas
    expect(crossedLowStock(8, 3, 5)).toBe(true);   // melompati batas
    expect(crossedLowStock(5, 4, 5)).toBe(false);  // sudah di bawah/sama sebelumnya → tidak diulang
    expect(crossedLowStock(10, 9, 5)).toBe(false); // masih di atas batas
  });
  it('batas 0 = tidak dipantau (termasuk saat stok habis)', () => {
    expect(crossedLowStock(1, 0, 0)).toBe(false);
  });
});
