import { describe, expect, it } from 'vitest';
import { formatDate, formatRp } from './format';

// Intl id-ID memakai spasi non-breaking (U+00A0) setelah "Rp".
const NB = ' ';

describe('formatRp', () => {
  it('memformat ribuan dengan titik tanpa desimal', () => {
    expect(formatRp(10000)).toBe(`Rp${NB}10.000`);
    expect(formatRp(1234567)).toBe(`Rp${NB}1.234.567`);
  });

  it('nol diformat sebagai Rp 0', () => {
    expect(formatRp(0)).toBe(`Rp${NB}0`);
  });

  it('negatif memakai tanda minus di depan simbol', () => {
    expect(formatRp(-5000)).toBe(`-Rp${NB}5.000`);
  });

  it('pecahan dibulatkan ke rupiah terdekat (half-expand)', () => {
    expect(formatRp(1234.5)).toBe(`Rp${NB}1.235`);
    expect(formatRp(1234.49)).toBe(`Rp${NB}1.234`);
  });

  it('angka sangat besar tidak kehilangan pemisah ribuan', () => {
    expect(formatRp(1_000_000_000_000)).toBe(`Rp${NB}1.000.000.000.000`);
  });

  it('NaN tidak melempar error (tampil "RpNaN" tanpa spasi; pemanggil wajib memastikan angka valid)', () => {
    expect(formatRp(NaN)).toBe('RpNaN');
  });

  it('null diperlakukan sebagai 0 (Intl mengonversi null -> 0), undefined menjadi NaN', () => {
    expect(formatRp(null as unknown as number)).toBe(`Rp${NB}0`);
    expect(formatRp(undefined as unknown as number)).toBe('RpNaN');
  });

  it('negatif kecil yang dibulatkan ke nol tidak menampilkan "-Rp 0"', () => {
    expect(formatRp(-0.4)).toBe(`Rp${NB}0`);
  });
});

describe('formatDate', () => {
  // 31 Des 2026 20:00 UTC = 1 Jan 2027 03:00 WIB (UTC+7): batas hari/bulan/tahun berubah antar zona.
  const lintasTahun = Date.UTC(2026, 11, 31, 20, 0, 0);

  it('zona Asia/Jakarta menggeser tanggal melewati pergantian tahun', () => {
    expect(formatDate(lintasTahun, 'short', 'Asia/Jakarta')).toBe('1 Jan 2027');
    expect(formatDate(lintasTahun, 'short', 'UTC')).toBe('31 Des 2026');
  });

  it('varian tanpa tahun dan nama bulan panjang', () => {
    const d = Date.UTC(2026, 10, 5, 7, 30); // 5 Nov 2026 14:30 WIB
    expect(formatDate(d, 'shortNoYear', 'Asia/Jakarta')).toBe('5 Nov');
    expect(formatDate(d, 'long', 'Asia/Jakarta')).toBe('5 November 2026');
  });

  it('varian jam memakai titik sebagai pemisah dan format 24 jam', () => {
    const d = Date.UTC(2026, 10, 5, 7, 30);
    expect(formatDate(d, 'time', 'Asia/Jakarta')).toBe('14.30');
    // Pemisah tanggal-jam bergantung versi ICU/browser: "5 Nov 14.30" atau "5 Nov, 14.30".
    expect(formatDate(d, 'dayTime', 'Asia/Jakarta')).toMatch(/^5 Nov,? 14\.30$/);
  });

  it('tengah malam tampil 00.xx (bukan 24.xx) pada dayTime', () => {
    const d = Date.UTC(2026, 10, 4, 17, 5); // 5 Nov 00:05 WIB
    expect(formatDate(d, 'dayTime', 'Asia/Jakarta')).toMatch(/^5 Nov,? 00\.05$/);
  });

  it('menerima Date, number (epoch ms), dan string ISO dengan hasil sama', () => {
    const iso = '2026-11-05T07:30:00.000Z';
    const a = formatDate(iso, 'datetime', 'Asia/Jakarta');
    expect(formatDate(new Date(iso), 'datetime', 'Asia/Jakarta')).toBe(a);
    expect(formatDate(Date.parse(iso), 'datetime', 'Asia/Jakarta')).toBe(a);
    expect(a).toContain('14.30');
  });

  it('string tanggal tanpa zona (YYYY-MM-DD) dibaca sebagai UTC: di WIB tetap hari yang sama', () => {
    expect(formatDate('2026-11-05', 'short', 'Asia/Jakarta')).toBe('5 Nov 2026');
  });

  it('tanggal tidak valid menghasilkan "Invalid Date" (tidak melempar)', () => {
    expect(formatDate('bukan-tanggal', 'short', 'Asia/Jakarta')).toBe('Invalid Date');
  });

  it('null jatuh diam-diam ke epoch 1970 (pemanggil harus menjaga null sendiri)', () => {
    expect(formatDate(null as unknown as number, 'short', 'UTC')).toBe('1 Jan 1970');
  });
});
