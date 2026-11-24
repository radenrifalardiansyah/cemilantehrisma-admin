import { describe, expect, it } from 'vitest';
import { initialWmState, makeArea, renderRect, wmReducer, type WmAction, type WmState } from './window-reducer';

const area = makeArea(1280, 720, 'windows');
const run = (actions: WmAction[], s: WmState = initialWmState(area)) => actions.reduce(wmReducer, s);
const win = (s: WmState, id: string) => s.windows.find(w => w.tabId === id)!;

describe('window-reducer: kasus tepi', () => {
  it('jendela maksimal lalu layar mengecil lalu dipulihkan: rect pulihan tetap di dalam area', () => {
    let s = run([{ type: 'open', tabId: 'dashboard' }, { type: 'maximize', tabId: 'dashboard' }]);
    s = wmReducer(s, { type: 'setArea', area: makeArea(1024, 600, 'windows') });
    s = wmReducer(s, { type: 'maximize', tabId: 'dashboard' }); // pulihkan
    const r = renderRect(win(s, 'dashboard'), s.area);
    expect(r.x + r.w).toBeLessThanOrEqual(1024);
    expect(r.y + r.h).toBeLessThanOrEqual(600 - 48);
  });

  it('pindah skin Windows -> Mac saat maksimal lalu dipulihkan: judul tidak di bawah menu bar (28)', () => {
    let s = run([{ type: 'open', tabId: 'a' }, { type: 'maximize', tabId: 'a' }]);
    s = wmReducer(s, { type: 'setArea', area: makeArea(1280, 720, 'mac') });
    s = wmReducer(s, { type: 'maximize', tabId: 'a' });
    expect(win(s, 'a').y).toBeGreaterThanOrEqual(28);
  });

  it('resize dengan kursor sampai tepi bawah layar tidak boleh membuat tepi bawah jendela masuk di bawah taskbar (pegangan jadi tak terjangkau)', () => {
    let s = run([{ type: 'open', tabId: 'a' }, { type: 'move', tabId: 'a', x: 100, y: 300 }]);
    s = wmReducer(s, { type: 'resize', tabId: 'a', x: 100, y: 300, w: 600, h: 720 - 300 }); // kursor di y=720
    const w = win(s, 'a');
    expect(w.y + w.h).toBeLessThanOrEqual(720 - 48);
  });
});

describe('window-reducer: jendela Kasir (pos, ukuran awal 1080x640)', () => {
  const widths = [1024, 1100, 1159, 1280, 1366, 1920];
  for (const skin of ['windows', 'mac'] as const) {
    for (const w of widths) {
      it(`${skin} ${w}px: jendela pos yang baru dibuka (urutan pertama) berada seluruhnya di dalam area layar (panel pesanan 400px di kanan tidak terpotong)`, () => {
        const a = makeArea(w, 800, skin);
        const s = run([{ type: 'open', tabId: 'pos' }], initialWmState(a));
        const p = win(s, 'pos');
        expect(p.x + p.w).toBeLessThanOrEqual(w);
        expect(p.y + p.h).toBeLessThanOrEqual(800 - a.bottom);
      });
    }
  }

  it('pos dibuka sebagai jendela ke-4 pada layar 1280px: seluruhnya di dalam area', () => {
    const s = run(['dashboard', 'orders', 'products', 'pos'].map(tabId => ({ type: 'open', tabId }) as WmAction));
    const p = win(s, 'pos');
    expect(p.x + p.w).toBeLessThanOrEqual(1280);
    expect(p.y + p.h).toBeLessThanOrEqual(720 - 48);
  });

  it('ukuran awal pos 1080x640 dipakai bila area cukup (1920x1080)', () => {
    const s = run([{ type: 'open', tabId: 'pos' }], initialWmState(makeArea(1920, 1080, 'windows')));
    expect(win(s, 'pos')).toMatchObject({ w: 1080, h: 640 });
  });
});

