import { describe, it, expect } from 'vitest';
import { buildLocationStockWaMessage, type LocationStockInput } from './location-stock-wa';
import { shoppingWaFits } from './shopping-wa';

const now = new Date('2026-11-23T07:30:00.000Z');
const s = (id: string, n: string, q: number) => ({ productId: id, productName: n, stockQty: q });
const locs: LocationStockInput[] = [
  { locationName: 'Kantin BGM 1', stock: [s('p1', 'Keripik Pedas', 12), s('p2', 'Basreng', 0), s('p3', 'Makaroni', 5)] },
  { locationName: 'Warung Bu Ani', stock: [s('p1', 'Keripik Pedas', 8)] },
  { locationName: 'Toko Kosong', stock: [] },
];

describe('buildLocationStockWaMessage', () => {
  it('per mitra, produk stok > 0, subtotal, total per produk dan total semua', () => {
    const m = buildLocationStockWaMessage(locs, { storeName: 'Toko A', now });
    expect(m).toContain('*SISA STOK DI MITRA - Toko A*');
    expect(m).toMatch(/Per: Senin, 23 Nov 2026.*14\.30 WIB/);
    expect(m).toContain('Jumlah mitra: 3');
    expect(m).toContain('1. *Kantin BGM 1*');
    expect(m).toContain('   - Keripik Pedas: 12 pcs');
    expect(m).not.toContain('Basreng: 0');
    expect(m).toContain('   Subtotal: 17 pcs');
    expect(m).toContain('3. *Toko Kosong*\n   Stok kosong');
    expect(m).toContain('- Keripik Pedas: 20 pcs');
    expect(m).toContain('*Total semua: 25 pcs*');
    expect(m).not.toMatch(/Rp/);
  });
  it('semua mitra kosong: total 0 tanpa blok total per produk', () => {
    const m = buildLocationStockWaMessage([{ locationName: 'A', stock: [] }], { now });
    expect(m).toContain('*Total semua: 0 pcs*');
    expect(m).not.toContain('TOTAL PER PRODUK');
  });
  it('ASCII murni, tanpa blok monospace, muat di batas URL WA untuk 10 mitra', () => {
    const many: LocationStockInput[] = Array.from({ length: 10 }, (_, i) => ({
      locationName: `Mitra ${i + 1} – \u{1F600}`, stock: Array.from({ length: 6 }, (_, j) => s(`p${j}`, `Produk ${j + 1}`, 10 + j)),
    }));
    const m = buildLocationStockWaMessage(many, { now });
    expect(/^[\x0a\x20-\x7e]*$/.test(m)).toBe(true);
    expect(m).not.toContain('```');
    expect(shoppingWaFits(m)).toBe(true);
  });
});
