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
