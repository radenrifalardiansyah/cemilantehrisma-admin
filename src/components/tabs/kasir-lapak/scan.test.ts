import { describe, it, expect } from 'vitest';
import { resolveStallScan } from './scan';
import type { CatalogItem } from './types';

const item = (o: Partial<CatalogItem>): CatalogItem => ({ kind: 'consign', productId: 'p1', name: 'A', code: 'TJP001', unit: 'pcs', price: 1, stock: 1, ...o });
const items = [item({}), item({ kind: 'own', productId: 'abc123', code: 'PRD9', name: 'B' })];

describe('resolveStallScan', () => {
  it('cocok lewat id, kode (tak peka huruf), dan URL produk', () => {
    expect(resolveStallScan('p1', items)?.name).toBe('A');
    expect(resolveStallScan('tjp001', items)?.name).toBe('A');
    expect(resolveStallScan(' PRD9 ', items)?.name).toBe('B');
    expect(resolveStallScan('https://toko.example/products/abc123?x=1', items)?.name).toBe('B');
  });
  it('null untuk teks kosong atau tak dikenal', () => {
    expect(resolveStallScan('', items)).toBeNull();
    expect(resolveStallScan('xxx', items)).toBeNull();
  });
});
