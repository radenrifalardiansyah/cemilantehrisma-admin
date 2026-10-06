import { describe, expect, it } from 'vitest';
import { buildGrItems, mergePoItems, remainingItems, type PoItem } from './purchase-orders-pg';
import { periodOf } from './doc-number';

const po: PoItem[] = [
  { materialId: 'tepung', materialName: 'Tepung', unit: 'kg', qty: 10, price: 12000, subtotal: 120000 },
  { materialId: 'gula', materialName: 'Gula', unit: 'kg', qty: 5, price: 15000, subtotal: 75000 },
];

describe('periodOf', () => {
  it('mengambil yyyymm dari tanggal', () => expect(periodOf('2026-10-06')).toBe('202610'));
});

describe('mergePoItems', () => {
  it('menjumlah bahan yang sama dengan harga rata-rata tertimbang', () => {
    const merged = mergePoItems([
      { materialId: 'a', materialName: 'A', unit: 'kg', qty: 2, price: 10, subtotal: 20 },
      { materialId: 'a', materialName: 'A', unit: 'kg', qty: 3, price: 20, subtotal: 60 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].qty).toBe(5);
    expect(merged[0].price).toBe(16);
  });
});

describe('remainingItems', () => {
  it('semua item saat belum ada yang diterima', () => {
    expect(remainingItems(po, new Map()).map(r => [r.materialId, r.qty])).toEqual([['tepung', 10], ['gula', 5]]);
  });
  it('mengurangi yang sudah diterima dan membuang yang penuh', () => {
    const r = remainingItems(po, new Map([['tepung', 4], ['gula', 5]]));
    expect(r.map(x => [x.materialId, x.qty, x.subtotal])).toEqual([['tepung', 6, 72000]]);
    expect(r[0].orderedQty).toBe(10);
  });
});

describe('buildGrItems', () => {
  it('membuang qty 0 dan memakai harga PO kalau tidak diisi', () => {
    const items = buildGrItems(po, new Map(), [{ materialId: 'tepung', qty: 6 }, { materialId: 'gula', qty: 0 }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ materialId: 'tepung', qty: 6, price: 12000, subtotal: 72000, orderedQty: 10 });
  });
  it('harga di nota supplier boleh beda dari PO', () => {
    expect(buildGrItems(po, new Map(), [{ materialId: 'gula', qty: 2, price: 16000 }])[0].subtotal).toBe(32000);
  });
  it('menolak qty melebihi sisa PO (termasuk yang sudah diterima GR lain)', () => {
    expect(() => buildGrItems(po, new Map([['tepung', 8]]), [{ materialId: 'tepung', qty: 3 }])).toThrow(/melebihi sisa/);
  });
  it('menolak bahan di luar PO, qty negatif, harga negatif, dan GR kosong', () => {
    expect(() => buildGrItems(po, new Map(), [{ materialId: 'susu', qty: 1 }])).toThrow(/tidak ada di PO/);
    expect(() => buildGrItems(po, new Map(), [{ materialId: 'gula', qty: -1 }])).toThrow(/0 atau lebih/);
    expect(() => buildGrItems(po, new Map(), [{ materialId: 'gula', qty: 1, price: -5 }])).toThrow(/Harga/);
    expect(() => buildGrItems(po, new Map(), [{ materialId: 'gula', qty: 0 }])).toThrow(/minimal untuk 1 bahan/);
  });
  it('menolak bahan yang sudah diterima penuh', () => {
    expect(() => buildGrItems(po, new Map([['gula', 5]]), [{ materialId: 'gula', qty: 1 }])).toThrow(/sudah diterima penuh/);
  });
});
