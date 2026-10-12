import { describe, it, expect } from 'vitest';
import { normalizeWaPhone, waLink, settlementMessage, receiptMessage, stockUpdateMessage } from './stall-whatsapp';

describe('normalizeWaPhone', () => {
  it('mengubah ke format internasional', () => {
    expect(normalizeWaPhone('0812-3456-7890')).toBe('6281234567890');
    expect(normalizeWaPhone('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizeWaPhone('81234567890')).toBe('6281234567890');
    expect(normalizeWaPhone('6281234567890')).toBe('6281234567890');
  });
  it('menolak nomor kosong/terlalu pendek', () => {
    expect(normalizeWaPhone('')).toBeNull();
    expect(normalizeWaPhone(undefined)).toBeNull();
    expect(normalizeWaPhone('0812')).toBeNull();
  });
});

describe('waLink', () => {
  it('menyertakan nomor dan teks ter-encode; tanpa nomor tetap valid', () => {
    expect(waLink('0812345678', 'Halo & salam')).toBe('https://wa.me/62812345678?text=Halo%20%26%20salam');
    expect(waLink('', 'x')).toBe('https://wa.me/?text=x');
  });
});

describe('pesan', () => {
  const s = { docNumber: 'TJB-202610-0001', consignorName: 'Bu Sari', stallName: 'Lapak 1', periodFrom: '2026-10-01', periodTo: '2026-10-10', totalAmount: 30000, status: 'unpaid' as const,
    items: [{ productName: 'Nastar', qty: 3, amount: 30000 }] };
  it('rekap ke penitip menyebut total bagian penitip', () => {
    const m = settlementMessage(s, 'Cemilan Teh Risma', 'penitip');
    expect(m).toContain('TJB-202610-0001'); expect(m).toContain('Nastar ×3 — Rp30.000'); expect(m).toContain('BAGIAN ANDA: Rp30.000'); expect(m).toContain('Belum dibayar');
  });
  it('rekap ke owner memakai kalimat laporan', () => {
    expect(settlementMessage({ ...s, status: 'paid' }, 'Toko', 'owner')).toContain('Laporan rekap titipan dari Lapak 1 untuk Bu Sari');
  });
  it('struk memuat kembalian hanya untuk tunai', () => {
    const base = { invoiceNo: 'LPK-1', stallName: 'Lapak 1', date: '2026-10-10', cashier: 'a', subtotal: 12000, discount: 0, total: 12000, amountPaid: 20000, changeAmount: 8000, items: [{ name: 'Susu', qty: 1, price: 12000, subtotal: 12000 }] };
    expect(receiptMessage({ ...base, paymentMethod: 'cash' }, 'Toko', 'Ani')).toContain('Kembali: Rp8.000');
    expect(receiptMessage({ ...base, paymentMethod: 'qris' }, 'Toko')).not.toContain('Kembali');
  });
});

describe('stockUpdateMessage', () => {
  const d = {
    stallName: 'Lapak 1', generatedAtText: '12 Okt 2026, 10.15', lastUpdateText: '12 Okt 2026, 07.30',
    consignors: [
      { name: 'JellyMo', products: [
        { name: 'Susu Jelly', unit: 'pcs', stock: 8, sold: 2, received: 5 },
        { name: 'Pudding', unit: 'pcs', stock: 0, sold: 3, received: 0 },
      ] },
      { name: 'Bu Sari', products: [{ name: 'Nastar', unit: 'toples', stock: 4, sold: 0, received: 0 }] },
    ],
  };
  it('daftar per penitip dengan stok, terjual, dan masuk sejak update sebelumnya', () => {
    const m = stockUpdateMessage(d, true);
    expect(m).toContain('*UPDATE STOK TITIPAN*'); expect(m).toContain('Lapak: Lapak 1');
    expect(m).toContain('Sejak update terakhir: 12 Okt 2026, 07.30');
    expect(m).toContain('*JellyMo*'); expect(m).toContain('1. Susu Jelly — stok *8* _(terjual 2, masuk 5)_');
    expect(m).toContain('2. Pudding — stok *0* (habis) _(terjual 3)_');
    expect(m).toContain('*Bu Sari*'); expect(m).toContain('1. Nastar — stok *4*');
    expect(m).toContain('Total: 3 produk, 12 stok');
  });
  it('tanpa produk stok 0 kecuali baru terjual; update pertama tanpa pembanding', () => {
    const m = stockUpdateMessage({ ...d, lastUpdateText: null, consignors: [{ name: 'X', products: [{ name: 'A', unit: 'pcs', stock: 0, sold: 0, received: 0 }, { name: 'B', unit: 'pcs', stock: 2, sold: 0, received: 0 }] }] }, false);
    expect(m).not.toContain('A —'); expect(m).toContain('1. B — stok *2*'); expect(m).toContain('Update pertama');
  });
});
