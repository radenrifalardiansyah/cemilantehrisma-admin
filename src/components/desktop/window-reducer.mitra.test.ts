import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOW_TABS } from '@/lib/ui-layout';
import { initialWmState, makeArea, minSizeFor, wmReducer, type WmAction, type WmState } from './window-reducer';

// Tahap 3 (Mitra berjendela): semua tab berjendela harus muat di dalam area pada resolusi umum,
// baik jendela pertama maupun saat semua jendela terbuka sekaligus, dan tidak ada ID jendela tanpa isi.

const SIZES: [number, number][] = [[1024, 768], [1280, 720], [1920, 1080], [1024, 600]];
const open = (ids: readonly string[]): WmAction[] => ids.map(tabId => ({ type: 'open', tabId }));

function expectInside(s: WmState, label: string) {
  const a = s.area;
  for (const w of s.windows) {
    const min = minSizeFor(w.tabId);
    expect(w.x, `${label} ${w.tabId} x`).toBeGreaterThanOrEqual(0);
    expect(w.x + w.w, `${label} ${w.tabId} kanan`).toBeLessThanOrEqual(a.w);
    expect(w.y, `${label} ${w.tabId} atas`).toBeGreaterThanOrEqual(a.top);
    expect(w.y + w.h, `${label} ${w.tabId} bawah`).toBeLessThanOrEqual(a.h - a.bottom);
    expect(w.w, `${label} ${w.tabId} lebar >= min`).toBeGreaterThanOrEqual(Math.min(min.w, a.w));
    expect(w.h, `${label} ${w.tabId} tinggi >= min`).toBeGreaterThanOrEqual(Math.min(min.h, a.h - a.top - a.bottom));
  }
}

describe('ukuran jendela tab berjendela (termasuk Mitra) pada berbagai layar', () => {
  for (const skin of ['windows', 'mac'] as const) {
    for (const [w, h] of SIZES) {
      it(`${skin} ${w}x${h}: tiap tab berjendela yang dibuka sendirian berada di dalam area`, () => {
        for (const id of WINDOW_TABS) {
          const s = open([id]).reduce(wmReducer, initialWmState(makeArea(w, h, skin)));
          expectInside(s, `${skin} ${w}x${h}`);
        }
      });
      it(`${skin} ${w}x${h}: semua tab berjendela terbuka sekaligus (jenjang lebih dari 6) tetap di dalam area, juga setelah arrange`, () => {
        let s = open(WINDOW_TABS).reduce(wmReducer, initialWmState(makeArea(w, h, skin)));
        expectInside(s, `${skin} ${w}x${h} buka`);
        s = wmReducer(s, { type: 'arrange' });
        expectInside(s, `${skin} ${w}x${h} arrange`);
      });
    }
  }

  it('ganti skin/ukuran layar saat semua jendela terbuka: tetap di dalam area (fitRect + minimum Mitra)', () => {
    let s = open(WINDOW_TABS).reduce(wmReducer, initialWmState(makeArea(1920, 1080, 'windows')));
    s = wmReducer(s, { type: 'setArea', area: makeArea(1024, 768, 'mac') });
    expectInside(s, 'windows->mac 1024x768');
  });
});

describe('setiap id WINDOW_TABS punya isi di renderTab (page.tsx)', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
  // 'pos' sengaja dirender terpisah (renderPos / PosHostMount), bukan lewat renderTab.
  for (const id of WINDOW_TABS.filter(t => t !== 'pos')) {
    it(`renderTab menangani tab '${id}'`, () => {
      expect(src).toMatch(new RegExp(`\\btab === '${id}'`));
    });
  }
});
