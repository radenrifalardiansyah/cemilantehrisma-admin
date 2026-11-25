import { describe, expect, it } from 'vitest';
import {
  initialWmState, makeArea, minSizeFor, normalRect, resizeRect, snapRect, snapSideAt, wmReducer,
  type ResizeEdge, type WmState,
} from './window-reducer';

const A = makeArea(1600, 900, 'windows');   // top 0, bottom 48 -> tinggi pakai 852
const MAC = makeArea(1600, 900, 'mac');     // top 28, bottom 66 -> tinggi pakai 806
const MIN = { w: 300, h: 200 };
const O = { x: 400, y: 300, w: 600, h: 400 };

describe('resizeRect: 8 arah', () => {
  const cases: [ResizeEdge, number, number, { x: number; y: number; w: number; h: number }][] = [
    ['e', 50, 99, { x: 400, y: 300, w: 650, h: 400 }],
    ['w', -50, 99, { x: 350, y: 300, w: 650, h: 400 }],
    ['s', 99, 40, { x: 400, y: 300, w: 600, h: 440 }],
    ['n', 99, -40, { x: 400, y: 260, w: 600, h: 440 }],
    ['se', 50, 40, { x: 400, y: 300, w: 650, h: 440 }],
    ['sw', -50, 40, { x: 350, y: 300, w: 650, h: 440 }],
    ['ne', 50, -40, { x: 400, y: 260, w: 650, h: 440 }],
    ['nw', -50, -40, { x: 350, y: 260, w: 650, h: 440 }],
  ];
  it.each(cases)('arah %s (dx %i, dy %i)', (edge, dx, dy, want) => {
    expect(resizeRect(edge, O, dx, dy, A, MIN)).toEqual(want);
  });

  it('tepi yang berlawanan tidak bergeser', () => {
    const r = resizeRect('nw', O, -80, -60, A, MIN);
    expect(r.x + r.w).toBe(O.x + O.w);
    expect(r.y + r.h).toBe(O.y + O.h);
    const r2 = resizeRect('se', O, 80, 60, A, MIN);
    expect([r2.x, r2.y]).toEqual([O.x, O.y]);
  });

  it('tidak melewati ukuran minimum dan tidak "mendorong" tepi seberang (kiri/atas)', () => {
    const w = resizeRect('w', O, 9999, 0, A, MIN);
    expect(w.w).toBe(MIN.w);
    expect(w.x + w.w).toBe(O.x + O.w);
    const n = resizeRect('n', O, 0, 9999, A, MIN);
    expect(n.h).toBe(MIN.h);
    expect(n.y + n.h).toBe(O.y + O.h);
    const e = resizeRect('e', O, -9999, 0, A, MIN);
    expect([e.x, e.w]).toEqual([O.x, MIN.w]);
    const s = resizeRect('s', O, 0, -9999, A, MIN);
    expect([s.y, s.h]).toEqual([O.y, MIN.h]);
    const nwse = resizeRect('nw', O, 9999, 9999, A, MIN);
    expect([nwse.w, nwse.h]).toEqual([MIN.w, MIN.h]);
  });

  it('tidak keluar dari area kerja: kiri 0, atas = inset atas, kanan = lebar, bawah di atas taskbar', () => {
    expect(resizeRect('w', O, -9999, 0, A, MIN).x).toBe(0);
    expect(resizeRect('n', O, 0, -9999, A, MIN).y).toBe(0);
    expect(resizeRect('n', O, 0, -9999, MAC, MIN).y).toBe(MAC.top);        // tidak masuk ke menu bar Mac
    const e = resizeRect('e', O, 9999, 0, A, MIN);
    expect(e.x + e.w).toBe(A.w);
    const s = resizeRect('s', O, 0, 9999, A, MIN);
    expect(s.y + s.h).toBe(A.h - A.bottom);                                // tidak masuk ke bawah taskbar
    expect(resizeRect('s', O, 0, 9999, MAC, MIN).y + resizeRect('s', O, 0, 9999, MAC, MIN).h).toBe(MAC.h - MAC.bottom);   // tidak ke bawah dock Mac
  });

  it('jendela yang sebagian sudah di luar area tidak melompat saat dipegang', () => {
    const off = { x: -200, y: 300, w: 600, h: 400 };
    const r = resizeRect('w', off, 0, 0, A, MIN);
    expect(r).toEqual(off);
    const r2 = resizeRect('w', off, -50, 0, A, MIN);   // tidak boleh menjulur lebih jauh keluar
    expect(r2.x).toBe(-200);
  });

  it('area lebih kecil dari minimum: minimum dijepit ke area', () => {
    const tiny = makeArea(280, 400, 'windows');
    const r = resizeRect('e', { x: 0, y: 0, w: 280, h: 300 }, -9999, 0, tiny, MIN);
    expect(r.w).toBe(280);
  });
});

describe('snapRect / snapSideAt', () => {
  it('kiri/kanan = setengah lebar, tinggi penuh area kerja; atas = area penuh', () => {
    expect(snapRect('left', A, MIN)).toEqual({ x: 0, y: 0, w: 800, h: 852 });
    expect(snapRect('right', A, MIN)).toEqual({ x: 800, y: 0, w: 800, h: 852 });
    expect(snapRect('top', A, MIN)).toEqual({ x: 0, y: 0, w: 1600, h: 852 });
  });
  it('Mac: inset menu bar 28 dan dock 66', () => {
    expect(snapRect('left', MAC, MIN)).toEqual({ x: 0, y: 28, w: 800, h: 806 });
    expect(snapRect('top', MAC, MIN)).toEqual({ x: 0, y: 28, w: 1600, h: 806 });
  });
  it('lebar minimum menang atas setengah layar (kanan tetap menempel ke tepi kanan)', () => {
    const narrow = makeArea(1000, 800, 'windows');
    const r = snapRect('right', narrow, { w: 720, h: 400 });
    expect(r.w).toBe(720);
    expect(r.x + r.w).toBe(1000);
  });
  it('snapSideAt: <= 8px dari tepi; atas mengalahkan kiri/kanan; di tengah tidak ada', () => {
    expect(snapSideAt(0, 400, A)).toBe('left');
    expect(snapSideAt(8, 400, A)).toBe('left');
    expect(snapSideAt(9, 400, A)).toBeNull();
    expect(snapSideAt(1600, 400, A)).toBe('right');
    expect(snapSideAt(1592, 400, A)).toBe('right');
    expect(snapSideAt(1591, 400, A)).toBeNull();
    expect(snapSideAt(800, 0, A)).toBe('top');
    expect(snapSideAt(800, 8, A)).toBe('top');
    expect(snapSideAt(800, 9, A)).toBeNull();
    expect(snapSideAt(0, 0, A)).toBe('top');
    expect(snapSideAt(800, MAC.top + 8, MAC)).toBe('top');
    expect(snapSideAt(800, MAC.top + 9, MAC)).toBeNull();
  });
});

const open = (s: WmState, tabId: string) => wmReducer(s, { type: 'open', tabId });
const win = (s: WmState, tabId: string) => s.windows.find(w => w.tabId === tabId)!;

describe('aksi snap', () => {
  const base = () => { let s = initialWmState(A); s = open(s, 'orders'); return s; };

  it('left/right menempel setengah layar, rect semula disimpan, jendela tampil di depan', () => {
    let s = base();
    const before = { ...normalRect(win(s, 'orders')) };
    s = open(s, 'products');
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'left' });
    const w = win(s, 'orders');
    expect(w).toMatchObject({ x: 0, y: 0, w: 800, h: 852, snapped: 'left', maximized: false, minimized: false });
    expect(w.restore).toEqual(before);
    expect(w.z).toBeGreaterThan(win(s, 'products').z);
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'right' });
    expect(win(s, 'orders')).toMatchObject({ x: 800, w: 800, snapped: 'right' });
    expect(win(s, 'orders').restore).toEqual(before);   // rect pra-tempel tidak tertimpa rect setengah
  });

  it('top memaksimalkan dan menyimpan rect pra-tempel sebagai rect normal', () => {
    let s = base();
    const before = { ...normalRect(win(s, 'orders')) };
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'left' });
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'top' });
    const w = win(s, 'orders');
    expect(w.maximized).toBe(true);
    expect(w.snapped).toBeUndefined();
    expect(normalRect(w)).toEqual(before);
    s = wmReducer(s, { type: 'maximize', tabId: 'orders' });   // toggle pulihkan
    expect(win(s, 'orders')).toMatchObject({ ...before, maximized: false });
  });

  it('menghormati lebar minimum tab dan tab tak dikenal tidak berubah', () => {
    let s = initialWmState(makeArea(1000, 800, 'windows'));
    s = open(s, 'pos');   // min 820
    s = wmReducer(s, { type: 'snap', tabId: 'pos', side: 'right' });
    expect(win(s, 'pos').w).toBe(minSizeFor('pos').w);
    expect(win(s, 'pos').x + win(s, 'pos').w).toBe(1000);
    expect(wmReducer(s, { type: 'snap', tabId: 'hantu', side: 'left' })).toBe(s);
  });

  it('jendela minimal yang di-snap dipulihkan', () => {
    let s = base();
    s = wmReducer(s, { type: 'minimize', tabId: 'orders' });
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'left' });
    expect(win(s, 'orders').minimized).toBe(false);
  });

  it('move/resize manual sesudah tempel melepas status tempel', () => {
    let s = base();
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'left' });
    s = wmReducer(s, { type: 'move', tabId: 'orders', x: 100, y: 100 });
    expect(win(s, 'orders').snapped).toBeUndefined();
    expect(win(s, 'orders').restore).toBeUndefined();
    let t = wmReducer(base(), { type: 'snap', tabId: 'orders', side: 'right' });
    t = wmReducer(t, { type: 'resize', tabId: 'orders', x: 700, y: 10, w: 700, h: 500 });
    expect(win(t, 'orders').snapped).toBeUndefined();
  });

  it('area berubah: jendela tertempel menempel ulang ke area baru', () => {
    let s = base();
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'right' });
    s = wmReducer(s, { type: 'setArea', area: makeArea(1200, 700, 'windows') });
    expect(win(s, 'orders')).toMatchObject({ x: 600, y: 0, w: 600, h: 652, snapped: 'right' });
  });

  it('arrange membersihkan status tempel', () => {
    let s = base();
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'left' });
    s = wmReducer(s, { type: 'arrange' });
    expect(win(s, 'orders').snapped).toBeUndefined();
    expect(win(s, 'orders').restore).toBeUndefined();
  });
});

describe('aksi restoreAt', () => {
  it('dari tempel: ukuran pra-tempel kembali, titlebar di posisi pointer', () => {
    let s = initialWmState(A);
    s = open(s, 'orders');
    const before = { ...normalRect(win(s, 'orders')) };
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'left' });
    s = wmReducer(s, { type: 'restoreAt', tabId: 'orders', x: 300, y: 40 });
    expect(win(s, 'orders')).toMatchObject({ x: 300, y: 40, w: before.w, h: before.h, maximized: false });
    expect(win(s, 'orders').snapped).toBeUndefined();
    expect(win(s, 'orders').restore).toBeUndefined();
  });
  it('dari maksimal: ukuran normal kembali; jendela biasa tidak berubah', () => {
    let s = initialWmState(A);
    s = open(s, 'orders');
    const before = { ...normalRect(win(s, 'orders')) };
    expect(wmReducer(s, { type: 'restoreAt', tabId: 'orders', x: 5, y: 5 })).toBe(s);
    s = wmReducer(s, { type: 'maximize', tabId: 'orders' });
    s = wmReducer(s, { type: 'restoreAt', tabId: 'orders', x: 200, y: 60 });
    expect(win(s, 'orders')).toMatchObject({ x: 200, y: 60, w: before.w, h: before.h, maximized: false });
  });
  it('posisi dijepit ke area (tidak lolos ke bawah taskbar / atas menu bar)', () => {
    let s = initialWmState(MAC);
    s = open(s, 'orders');
    s = wmReducer(s, { type: 'maximize', tabId: 'orders' });
    s = wmReducer(s, { type: 'restoreAt', tabId: 'orders', x: 100, y: -50 });
    expect(win(s, 'orders').y).toBe(MAC.top);
    s = wmReducer(s, { type: 'maximize', tabId: 'orders' });
    s = wmReducer(s, { type: 'restoreAt', tabId: 'orders', x: 100, y: 99999 });
    expect(win(s, 'orders').y).toBeLessThanOrEqual(MAC.h - MAC.bottom - 38);
  });
});

describe('open dengan rect tersimpan, settle', () => {
  it('rect tersimpan dijepit/ditarik masuk ke area saat ini', () => {
    const s0 = initialWmState(makeArea(1000, 700, 'windows'));
    const s = wmReducer(s0, { type: 'open', tabId: 'orders', rect: { x: 1500, y: 650, w: 900, h: 600 } });
    const w = win(s, 'orders');
    expect(w.x + w.w).toBeLessThanOrEqual(1000);
    expect(w.y + w.h).toBeLessThanOrEqual(700 - 48);
    expect(w.w).toBeLessThanOrEqual(1000);
  });
  it('rect tersimpan yang muat dipakai apa adanya; tanpa rect memakai cascade', () => {
    const s0 = initialWmState(A);
    const saved = { x: 123, y: 77, w: 700, h: 450 };
    expect(win(wmReducer(s0, { type: 'open', tabId: 'orders', rect: saved }), 'orders')).toMatchObject(saved);
    const plain = win(open(s0, 'orders'), 'orders');
    expect(plain.x).toBe(96);   // cascade pertama
  });
  it('membuka tab yang sudah ada mengabaikan rect (hanya fokus)', () => {
    let s = open(initialWmState(A), 'orders');
    const before = { ...win(s, 'orders') };
    s = wmReducer(s, { type: 'open', tabId: 'orders', rect: { x: 5, y: 5, w: 400, h: 300 } });
    expect(win(s, 'orders')).toMatchObject({ x: before.x, y: before.y, w: before.w, h: before.h });
  });
  it('settle menghasilkan state baru untuk jendela yang ada dan tidak mengubah isinya; tab tak dikenal tetap', () => {
    const s = open(initialWmState(A), 'orders');
    const t = wmReducer(s, { type: 'settle', tabId: 'orders' });
    expect(t).not.toBe(s);
    expect(t.windows).toEqual(s.windows);
    expect(wmReducer(s, { type: 'settle', tabId: 'hantu' })).toBe(s);
  });
});

describe('snap dengan from (rect sebelum drag) dan rect diinginkan (desired)', () => {
  const FROM = { x: 300, y: 150, w: 800, h: 500 };
  it('snap left/right/top memakai from sebagai rect pemulihan, bukan posisi jendela yang sudah bergeser ke tepi', () => {
    for (const side of ['left', 'right'] as const) {
      let s = open(initialWmState(A), 'orders');
      s = wmReducer(s, { type: 'move', tabId: 'orders', x: -197, y: 310 });          // jendela ikut terseret ke tepi selama drag
      s = wmReducer(s, { type: 'snap', tabId: 'orders', side, from: FROM });
      expect(win(s, 'orders').restore).toEqual(FROM);
      s = wmReducer(s, { type: 'restoreAt', tabId: 'orders', x: 300, y: 150 });
      expect(win(s, 'orders')).toMatchObject(FROM);
    }
    let t = open(initialWmState(A), 'orders');
    t = wmReducer(t, { type: 'move', tabId: 'orders', x: 500, y: 0 });
    t = wmReducer(t, { type: 'snap', tabId: 'orders', side: 'top', from: FROM });
    expect(normalRect(win(t, 'orders'))).toEqual(FROM);
    t = wmReducer(t, { type: 'maximize', tabId: 'orders' });                         // toggle pulihkan
    expect(win(t, 'orders')).toMatchObject(FROM);
  });
  it('tanpa from tetap memakai rect normal sekarang (pintasan keyboard)', () => {
    let s = open(initialWmState(A), 'orders');
    const cur = { ...normalRect(win(s, 'orders')) };
    s = wmReducer(s, { type: 'snap', tabId: 'orders', side: 'left' });
    expect(win(s, 'orders').restore).toEqual(cur);
  });
  it('setArea menyusutkan lalu memperbesar: jendela tumbuh kembali ke rect diinginkan; normalRect = rect diinginkan', () => {
    let s = wmReducer(initialWmState(A), { type: 'open', tabId: 'orders', rect: { x: 100, y: 60, w: 1200, h: 700 } });
    s = wmReducer(s, { type: 'setArea', area: makeArea(800, 500, 'windows') });
    expect(win(s, 'orders').w).toBeLessThanOrEqual(800);
    expect(normalRect(win(s, 'orders'))).toEqual({ x: 100, y: 60, w: 1200, h: 700 });
    s = wmReducer(s, { type: 'setArea', area: A });
    expect(win(s, 'orders')).toMatchObject({ x: 100, y: 60, w: 1200, h: 700 });
  });
  it('aksi pengguna (move/resize) memperbarui rect diinginkan; arrange menghapusnya', () => {
    let s = wmReducer(initialWmState(A), { type: 'open', tabId: 'orders', rect: { x: 100, y: 60, w: 1200, h: 700 } });
    s = wmReducer(s, { type: 'move', tabId: 'orders', x: 150, y: 80 });
    expect(normalRect(win(s, 'orders'))).toMatchObject({ x: 150, y: 80, w: 1200, h: 700 });
    s = wmReducer(s, { type: 'resize', tabId: 'orders', x: 150, y: 80, w: 900, h: 600 });
    expect(normalRect(win(s, 'orders'))).toEqual({ x: 150, y: 80, w: 900, h: 600 });
    s = wmReducer(s, { type: 'arrange' });
    expect(win(s, 'orders').desired).toBeUndefined();
  });
});
