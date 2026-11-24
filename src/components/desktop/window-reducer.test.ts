import { describe, expect, it } from 'vitest';
import {
  MIN_H, MIN_W, focusedTabId, initialWmState, makeArea, renderRect, topTabId, wmReducer, type WmAction, type WmState,
} from './window-reducer';

const area = makeArea(1280, 720, 'windows');
const run = (actions: WmAction[], s: WmState = initialWmState(area)) => actions.reduce(wmReducer, s);
const win = (s: WmState, id: string) => s.windows.find(w => w.tabId === id)!;

describe('open', () => {
  it('membuat jendela baru dan memfokusnya', () => {
    const s = run([{ type: 'open', tabId: 'dashboard' }]);
    expect(s.windows).toHaveLength(1);
    expect(focusedTabId(s)).toBe('dashboard');
  });
  it('singleton: open pada tab yang sudah ada memulihkan + memfokus, tidak menggandakan', () => {
    const s = run([
      { type: 'open', tabId: 'a' }, { type: 'open', tabId: 'b' },
      { type: 'minimize', tabId: 'a' }, { type: 'open', tabId: 'a' },
    ]);
    expect(s.windows).toHaveLength(2);
    expect(win(s, 'a').minimized).toBe(false);
    expect(focusedTabId(s)).toBe('a');
  });
  it('jendela baru berjenjang dan berada di dalam area', () => {
    const s = run([{ type: 'open', tabId: 'a' }, { type: 'open', tabId: 'b' }]);
    expect(win(s, 'b').x).toBeGreaterThan(win(s, 'a').x);
    for (const w of s.windows) {
      expect(w.y).toBeGreaterThanOrEqual(area.top);
      expect(w.y + w.h).toBeLessThanOrEqual(area.h - area.bottom);
      expect(w.x + w.w).toBeLessThanOrEqual(area.w);
    }
  });
  it('area Mac: jendela tidak menyentuh menu bar (top 28) maupun dock (bottom 92)', () => {
    const mac = makeArea(1280, 720, 'mac');
    const s = run([{ type: 'open', tabId: 'a' }], initialWmState(mac));
    expect(win(s, 'a').y).toBeGreaterThanOrEqual(28);
    expect(win(s, 'a').y + win(s, 'a').h).toBeLessThanOrEqual(720 - 92);
  });
});

describe('focus / minimize / maximize / close', () => {
  it('focus menaikkan z; minimize melepas fokus ke jendela di bawahnya', () => {
    let s = run([{ type: 'open', tabId: 'a' }, { type: 'open', tabId: 'b' }]);
    expect(focusedTabId(s)).toBe('b');
    s = run([{ type: 'focus', tabId: 'a' }], s);
    expect(focusedTabId(s)).toBe('a');
    s = run([{ type: 'minimize', tabId: 'a' }], s);
    expect(focusedTabId(s)).toBe('b');
    expect(topTabId(s, 'b')).toBeNull();
  });
  it('semua diminimalkan: tidak ada fokus', () => {
    const s = run([{ type: 'open', tabId: 'a' }, { type: 'minimize', tabId: 'a' }]);
    expect(focusedTabId(s)).toBeNull();
  });
  it('focus pada jendela minimal memulihkannya', () => {
    const s = run([{ type: 'open', tabId: 'a' }, { type: 'minimize', tabId: 'a' }, { type: 'focus', tabId: 'a' }]);
    expect(focusedTabId(s)).toBe('a');
  });
  it('maximize adalah toggle dan renderRect memenuhi area di antara inset', () => {
    let s = run([{ type: 'open', tabId: 'a' }, { type: 'maximize', tabId: 'a' }]);
    expect(win(s, 'a').maximized).toBe(true);
    expect(renderRect(win(s, 'a'), s.area)).toEqual({ x: 0, y: 0, w: 1280, h: 720 - 48 });
    s = run([{ type: 'maximize', tabId: 'a' }], s);
    expect(win(s, 'a').maximized).toBe(false);
  });
  it('close menghapus; fokus pindah ke jendela teratas berikutnya; aksi pada tab tak dikenal no-op', () => {
    const s = run([{ type: 'open', tabId: 'a' }, { type: 'open', tabId: 'b' }, { type: 'close', tabId: 'b' }]);
    expect(s.windows.map(w => w.tabId)).toEqual(['a']);
    expect(focusedTabId(s)).toBe('a');
    const same = run([{ type: 'close', tabId: 'zzz' }, { type: 'focus', tabId: 'zzz' }, { type: 'minimize', tabId: 'zzz' }], s);
    expect(same).toBe(s);
  });
  it('closeAll mengosongkan', () => {
    const s = run([{ type: 'open', tabId: 'a' }, { type: 'open', tabId: 'b' }, { type: 'closeAll' }]);
    expect(s.windows).toEqual([]);
  });
});

describe('move / resize / clamp', () => {
  it('move dijepit supaya judul tetap terjangkau', () => {
    let s = run([{ type: 'open', tabId: 'a' }, { type: 'move', tabId: 'a', x: 99999, y: 99999 }]);
    expect(win(s, 'a').x).toBe(area.w - 80);
    expect(win(s, 'a').y).toBe(area.h - area.bottom - 38);
    s = run([{ type: 'move', tabId: 'a', x: -99999, y: -99999 }], s);
    expect(win(s, 'a').x).toBe(-(win(s, 'a').w - 80));
    expect(win(s, 'a').y).toBe(area.top);
  });
  it('move diabaikan saat maksimal', () => {
    const s = run([{ type: 'open', tabId: 'a' }, { type: 'maximize', tabId: 'a' }]);
    const x = win(s, 'a').x;
    expect(win(run([{ type: 'move', tabId: 'a', x: 5, y: 5 }], s), 'a').x).toBe(x);
  });
  it('resize dibatasi minimum dan area', () => {
    let s = run([{ type: 'open', tabId: 'a' }, { type: 'resize', tabId: 'a', x: 10, y: 10, w: 10, h: 10 }]);
    expect(win(s, 'a').w).toBe(MIN_W);
    expect(win(s, 'a').h).toBe(MIN_H);
    s = run([{ type: 'resize', tabId: 'a', x: 10, y: 10, w: 99999, h: 99999 }], s);
    expect(win(s, 'a').w).toBe(area.w);
    expect(win(s, 'a').h).toBe(area.h - area.bottom - win(s, 'a').y);
  });
});

describe('arrange / setArea', () => {
  it('arrange mengembalikan ukuran/posisi, melepas maksimal, dan mempertahankan jendela minimal', () => {
    let s = run([
      { type: 'open', tabId: 'a' }, { type: 'open', tabId: 'b' },
      { type: 'maximize', tabId: 'a' }, { type: 'minimize', tabId: 'b' }, { type: 'arrange' },
    ]);
    expect(win(s, 'a').maximized).toBe(false);
    expect(win(s, 'b').minimized).toBe(true);
    expect(s.windows).toHaveLength(2);
    s = run([{ type: 'arrange' }], s);
    expect(s.windows).toHaveLength(2);
  });
  it('setArea mengecilkan jendela yang melebihi area baru dan mengabaikan area yang sama', () => {
    let s = run([{ type: 'open', tabId: 'dashboard' }]);
    const small = makeArea(700, 500, 'windows');
    const before = s;
    expect(wmReducer(s, { type: 'setArea', area: s.area })).toBe(before);
    s = wmReducer(s, { type: 'setArea', area: small });
    const w = win(s, 'dashboard');
    expect(w.w).toBeLessThanOrEqual(700);
    expect(w.y + w.h).toBeLessThanOrEqual(500 - 48);
  });
  it('setArea pindah skin (insets berubah) menjaga jendela di bawah menu bar', () => {
    let s = run([{ type: 'open', tabId: 'a' }, { type: 'move', tabId: 'a', x: 100, y: 0 }]);
    s = wmReducer(s, { type: 'setArea', area: makeArea(1280, 720, 'mac') });
    expect(win(s, 'a').y).toBeGreaterThanOrEqual(28);
  });
});
