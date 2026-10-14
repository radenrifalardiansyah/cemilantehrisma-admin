import { describe, it, expect } from 'vitest';
import { shouldForward, buildForwardMessage, normalizeText } from './wa-forward';
import * as worker from '../../wa-worker/filter.mjs';

// Worker memegang salinan logika filter/format (paket terpisah). Tes ini menjaga keduanya tetap identik.
describe('wa-worker/filter.mjs identik dengan src/lib/wa-forward.ts', () => {
  const texts = ['STOK: mie kremes 12 pcs', 'sisa!! 5', 'selamat pagi', 'stokis baru', 'Mie   Kremes habis, tolong kirim', '', '  ', 'Ｓｔｏｋ ２０'];
  const kw = ['stok', 'sisa', 'mie kremes'];
  it('normalizeText & shouldForward', () => {
    for (const t of texts) {
      expect(worker.normalizeText(t)).toBe(normalizeText(t));
      expect(worker.shouldForward(t, kw, ['tolong'])).toBe(shouldForward(t, kw, ['tolong']));
    }
  });
  it('buildForwardMessage', () => {
    const p = { locationName: 'Kopi Nusantara', senderName: 'Budi', at: new Date('2026-10-14T03:32:00Z'), body: ' stok 12 ' };
    expect(worker.buildForwardMessage(p)).toBe(buildForwardMessage(p));
  });
});
