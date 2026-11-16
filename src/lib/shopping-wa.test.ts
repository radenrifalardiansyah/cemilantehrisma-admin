import { describe, it, expect } from 'vitest';
import { buildShoppingWaMessage, shoppingWaUrl, type ShoppingWaGroup, type ShoppingWaItem } from './shopping-wa';

const item = (o: Partial<ShoppingWaItem> = {}): ShoppingWaItem =>
  ({ materialName: 'Gula Pasir', unit: 'kg', qty: 2, price: null, status: 'pending', ...o });
const grp = (o: Partial<ShoppingWaGroup> = {}): ShoppingWaGroup =>
  ({ date: '2026-11-16', supplierName: 'UD Sumber Tani', registeredSupplier: true, items: [item()], notes: [], ...o });

describe('buildShoppingWaMessage', () => {
  it('ASCII murni dan tanpa blok monospace', () => {
    const m = buildShoppingWaMessage(grp({ items: [item({ price: 15000, qty: 2.5 })], notes: ['Kirim pagi – ya \u{1F600}'] }), { storeName: 'Toko — A' });
    expect(/^[\x0a\x20-\x7e]*$/.test(m)).toBe(true);
    expect(m).not.toContain('```');
  });
  it('judul, tanggal, supplier, penutup', () => {
    const m = buildShoppingWaMessage(grp(), { storeName: 'Toko Uji' });
    expect(m).toContain('*DAFTAR BELANJA - Toko Uji*');
    expect(m).toContain('Tanggal: 16 Nov 2026');
    expect(m).toContain('Supplier: UD Sumber Tani');
    expect(m).toContain('1. Gula Pasir - 2 kg');
    expect(m).toContain('Mohon konfirmasi ketersediaan. Terima kasih.');
  });
  it('nama toko fallback', () => {
    expect(buildShoppingWaMessage(grp())).toContain('*DAFTAR BELANJA - Cemilan Teh Risma*');
    expect(buildShoppingWaMessage(grp(), { storeName: '  ' })).toContain('Cemilan Teh Risma');
  });
  it('supplier tak terdaftar memakai label Toko', () => {
    const m = buildShoppingWaMessage(grp({ registeredSupplier: false, supplierName: 'Warung Bu Ani' }));
    expect(m).toContain('Toko: Warung Bu Ani');
    expect(m).not.toContain('Supplier:');
  });
  it('qty pecahan maks 2 desimal, bulat tanpa desimal', () => {
    const m = buildShoppingWaMessage(grp({ items: [item({ qty: 1.2345 }), item({ materialName: 'Telur', unit: 'butir', qty: 30 })] }));
    expect(m).toContain('1. Gula Pasir - 1,23 kg');
    expect(m).toContain('2. Telur - 30 butir');
  });
  it('harga 0/null disembunyikan; total tak muncul tanpa harga', () => {
    const m = buildShoppingWaMessage(grp({ items: [item({ price: 0 }), item({ price: null })] }));
    expect(m).not.toContain('@');
    expect(m).not.toContain('Total');
  });
  it('harga > 0 menampilkan baris @ dan total tebal (hanya item berharga)', () => {
    const m = buildShoppingWaMessage(grp({ items: [item({ price: 15000 }), item({ materialName: 'Garam', price: null })] }));
    expect(m).toContain('   @ Rp 15.000 = Rp 30.000');
    expect(m).toContain('*Total: Rp 30.000*');
    expect(m.match(/@/g)).toHaveLength(1);
  });
  it('hanya item pending bila masih ada yang belum dibeli', () => {
    const m = buildShoppingWaMessage(grp({ items: [item({ materialName: 'Sudah', status: 'done' }), item({ materialName: 'Belum' })] }));
    expect(m).toContain('1. Belum');
    expect(m).not.toContain('Sudah');
  });
  it('semua selesai: kirim semua item', () => {
    const m = buildShoppingWaMessage(grp({ items: [item({ materialName: 'A', status: 'done' }), item({ materialName: 'B', status: 'done' })] }));
    expect(m).toContain('1. A - 2 kg');
    expect(m).toContain('2. B - 2 kg');
  });
  it('catatan daftar disertakan', () => {
    expect(buildShoppingWaMessage(grp({ notes: ['Ambil sore'] }))).toContain('Catatan: Ambil sore');
  });
});

describe('shoppingWaUrl', () => {
  it('nomor dinormalisasi', () => {
    expect(shoppingWaUrl('0812-3456-7890', 'a b')).toBe('https://wa.me/6281234567890?text=a%20b');
    expect(shoppingWaUrl('+62 812 3456 7890', 'x')).toContain('wa.me/6281234567890?');
  });
  it('tanpa nomor: wa.me/?text=', () => {
    expect(shoppingWaUrl('', 'x')).toBe('https://wa.me/?text=x');
    expect(shoppingWaUrl(undefined, 'x')).toBe('https://wa.me/?text=x');
    expect(shoppingWaUrl('  ', 'x')).toBe('https://wa.me/?text=x');
  });
});
