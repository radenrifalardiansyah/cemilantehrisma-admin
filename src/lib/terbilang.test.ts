import { describe, expect, it } from 'vitest';
import { terbilangRupiah } from './terbilang';

describe('terbilangRupiah', () => {
  it.each([
    [0, 'nol rupiah'],
    [1000, 'seribu rupiah'],
    [1500, 'seribu lima ratus rupiah'],
    [11000, 'sebelas ribu rupiah'],
    [100000, 'seratus ribu rupiah'],
    [225000, 'dua ratus dua puluh lima ribu rupiah'],
    [6840, 'enam ribu delapan ratus empat puluh rupiah'],
    [2_000_000, 'dua juta rupiah'],
    [1_250_000, 'satu juta dua ratus lima puluh ribu rupiah'],
    [1_000_000_000, 'satu miliar rupiah'],
    [15, 'lima belas rupiah'],
  ])('%i -> %s', (n, expected) => expect(terbilangRupiah(n)).toBe(expected));
  it('membulatkan ke rupiah penuh', () => expect(terbilangRupiah(999.6)).toBe('seribu rupiah'));
});
