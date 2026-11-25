import { describe, it, expect } from 'vitest';
import { buildWalletBalanceWaMessage } from './wallet-balance-wa';
import { shoppingWaFits, plainText } from './shopping-wa';
import { formatRp } from './format';

const now = new Date('2026-11-23T07:30:00.000Z'); // Senin 23 Nov 2026 14.30 WIB
const ws = [
  { name: 'Cash', balance: 11_300, isActive: true },
  { name: 'BCA an Sindy', balance: 244_636, isActive: true },
  { name: 'Gopay Rifal', balance: 64_000, isActive: true },
];

describe('buildWalletBalanceWaMessage', () => {
  it('daftar dompet, total, dan keterangan cakupan', () => {
    const m = buildWalletBalanceWaMessage(ws, { storeName: 'Toko A', now });
    expect(m).toContain('*SALDO DOMPET - Toko A*');
    expect(m).toMatch(/Per: Senin, 23 Nov 2026.*14\.30 WIB/);
    expect(m).toContain('Dompet: semua dompet aktif');
    expect(m).toContain('1. Cash: Rp');
    expect(m).toContain('2. BCA an Sindy');
    expect(m).toContain('*Total saldo: Rp');
    expect(m).toContain(`*Total saldo: ${plainText(formatRp(319_936))}*`);
  });
  it('total benar, termasuk saldo negatif', () => {
    const m = buildWalletBalanceWaMessage([{ name: 'A', balance: 1000 }, { name: 'B', balance: -250, isActive: true }], { scope: 'terpilih', now });
    expect(m).toContain('Dompet: 2 dompet terpilih');
    expect(m).toContain('2. B: ');
    expect(m).toMatch(/Total saldo: -?Rp\s?750/);
  });
  it('dompet nonaktif tidak ikut: tidak ada barisnya, tidak masuk total, dan jumlah terpilih hanya yang aktif', () => {
    const m = buildWalletBalanceWaMessage(
      [{ name: 'Aktif', balance: 1000, isActive: true }, { name: 'Mati', balance: 99_999, isActive: false }],
      { scope: 'terpilih', now },
    );
    expect(m).toContain('Dompet: 1 dompet terpilih');
    expect(m).toContain('1. Aktif');
    expect(m).not.toContain('Mati');
    expect(m).not.toContain('nonaktif');
    expect(m).toMatch(/Total saldo: -?Rp\s?1\.000/);
  });
  it('dompet tanpa penanda isActive dianggap aktif (kompatibel dengan pemanggil lama)', () => {
    const m = buildWalletBalanceWaMessage([{ name: 'A', balance: 500 }], { scope: 'semua', now });
    expect(m).toContain('1. A: ');
  });
  it('ASCII murni, tanpa blok monospace, dan muat di batas URL WA', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Dompet ${i + 1} – \u{1F600}`, balance: 1_234_567 + i }));
    const m = buildWalletBalanceWaMessage(many, { now });
    expect(/^[\x0a\x20-\x7e]*$/.test(m)).toBe(true);
    expect(m).not.toContain('```');
    expect(shoppingWaFits(m)).toBe(true);
  });
});
