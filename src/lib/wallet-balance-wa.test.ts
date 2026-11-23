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
  it('total benar, termasuk saldo negatif dan tanda nonaktif pada pilihan', () => {
    const m = buildWalletBalanceWaMessage([{ name: 'A', balance: 1000 }, { name: 'B', balance: -250, isActive: false }], { scope: 'terpilih', now });
    expect(m).toContain('Dompet: 2 dompet terpilih');
    expect(m).toContain('2. B (nonaktif)');
    expect(m).toMatch(/Total saldo: -?Rp\s?750/);
  });
  it('ASCII murni, tanpa blok monospace, dan muat di batas URL WA', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Dompet ${i + 1} – \u{1F600}`, balance: 1_234_567 + i }));
    const m = buildWalletBalanceWaMessage(many, { now });
    expect(/^[\x0a\x20-\x7e]*$/.test(m)).toBe(true);
    expect(m).not.toContain('```');
    expect(shoppingWaFits(m)).toBe(true);
  });
});
