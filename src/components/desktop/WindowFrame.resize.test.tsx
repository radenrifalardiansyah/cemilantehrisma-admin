// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayoutDashboard } from 'lucide-react';
import WindowFrame from './WindowFrame';
import { makeArea, type WinState, type WmAction } from './window-reducer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = { tab: 'orders', label: 'Pesanan', Icon: LayoutDashboard, color: '#D4691E', windowed: true, badge: 0 };
const AREA = makeArea(1600, 900, 'windows');
const base = (p: Partial<WinState> = {}): WinState => ({ tabId: 'orders', x: 400, y: 300, w: 600, h: 400, z: 1, minimized: false, maximized: false, ...p });
let host: HTMLDivElement; let root: Root;
let onMove: ReturnType<typeof vi.fn>; let onResize: ReturnType<typeof vi.fn>; let dispatch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  onMove = vi.fn(); onResize = vi.fn(); dispatch = vi.fn();
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const render = (win: WinState, withDispatch = true) => act(() => root.render(
  <WindowFrame win={win} area={AREA} item={item} focused zIndex={1} onFocus={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}}
    onMove={onMove} onResize={onResize} dispatch={withDispatch ? dispatch : undefined}>isi</WindowFrame>,
));
const fire = (el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number) =>
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
const handle = (edge: string) => document.querySelector(`.dsk-rs.${edge}`)!;
const titlebar = () => document.querySelector('.dsk-tb')!;
const lastResize = () => onResize.mock.calls[onResize.mock.calls.length - 1][0];
const actions = () => dispatch.mock.calls.map(c => (c[0] as WmAction).type);

describe('WindowFrame: pegangan ubah ukuran', () => {
  it('ada 8 pegangan dengan kelas arah masing-masing, dan tidak ada pada jendela maksimal', () => {
    render(base());
    const edges = [...document.querySelectorAll('.dsk-rs')].map(e => e.getAttribute('data-drag')).sort();
    expect(edges).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    render(base({ maximized: true }));
    expect(document.querySelectorAll('.dsk-rs')).toHaveLength(0);
  });

  const cases: [string, number, number, { x: number; y: number; w: number; h: number }][] = [
    ['e', 40, 0, { x: 400, y: 300, w: 640, h: 400 }],
    ['w', -40, 0, { x: 360, y: 300, w: 640, h: 400 }],
    ['s', 0, 30, { x: 400, y: 300, w: 600, h: 430 }],
    ['n', 0, -30, { x: 400, y: 270, w: 600, h: 430 }],
    ['se', 40, 30, { x: 400, y: 300, w: 640, h: 430 }],
    ['sw', -40, 30, { x: 360, y: 300, w: 640, h: 430 }],
    ['ne', 40, -30, { x: 400, y: 270, w: 640, h: 430 }],
    ['nw', -40, -30, { x: 360, y: 270, w: 640, h: 430 }],
  ];
  it.each(cases)('geser pegangan %s memanggil onResize dengan rect yang benar saat dilepas', (edge, dx, dy, want) => {
    render(base());
    const h = handle(edge);
    fire(h, 'pointerdown', 500, 400);
    fire(h, 'pointermove', 500 + dx, 400 + dy);
    fire(h, 'pointerup', 500 + dx, 400 + dy);
    expect(lastResize()).toEqual(want);
    expect(onMove).not.toHaveBeenCalled();
    expect(actions()).toContain('settle');
  });

  it('tidak melewati ukuran minimum dan tidak mendorong tepi seberang', () => {
    render(base());
    const h = handle('nw');
    fire(h, 'pointerdown', 500, 400);
    fire(h, 'pointermove', 5000, 5000);
    fire(h, 'pointerup', 5000, 5000);
    const r = lastResize();
    expect(r.w).toBe(320); expect(r.h).toBe(200);          // MIN_W/MIN_H tab tanpa minimum khusus
    expect(r.x + r.w).toBe(1000); expect(r.y + r.h).toBe(700);
  });

  it('pointercancel membatalkan: tidak menerapkan rect, tidak ada listener tersisa (gerak berikutnya diabaikan)', () => {
    render(base());
    const h = handle('e');
    fire(h, 'pointerdown', 500, 400);
    fire(h, 'pointercancel', 500, 400);
    onResize.mockClear();
    fire(h, 'pointermove', 600, 400);
    fire(h, 'pointerup', 600, 400);
    expect(onResize).not.toHaveBeenCalled();
  });

  it('tombol kanan tidak memulai geser', () => {
    render(base());
    const h = handle('e');
    act(() => { h.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 400, button: 2 })); });
    fire(h, 'pointerup', 560, 400);
    expect(onResize).not.toHaveBeenCalled();
  });
});

describe('WindowFrame: tempel ke tepi dan lepas dari maksimal', () => {
  it('menyeret titlebar ke tepi kiri/kanan/atas menampilkan pratinjau dan melepas = aksi snap', () => {
    render(base());
    for (const [x, y, side] of [[3, 400, 'left'], [1598, 400, 'right'], [800, 2, 'top']] as const) {
      dispatch.mockClear();
      const tb = titlebar();
      fire(tb, 'pointerdown', 800, 310);
      fire(tb, 'pointermove', x, y);
      expect(document.querySelector('.dsk-snap')).not.toBeNull();
      fire(tb, 'pointerup', x, y);
      expect(dispatch).toHaveBeenCalledWith({ type: 'snap', tabId: 'orders', side, from: { x: 400, y: 300, w: 600, h: 400 } });   // rect SEBELUM drag
      expect(document.querySelector('.dsk-snap')).toBeNull();
    }
  });

  it('pratinjau memakai rect tempel (kiri: setengah lebar, tinggi area kerja) dan hilang saat pointer menjauh dari tepi', () => {
    render(base());
    const tb = titlebar();
    fire(tb, 'pointerdown', 800, 310);
    fire(tb, 'pointermove', 4, 400);
    const p = document.querySelector('.dsk-snap') as HTMLElement;
    expect([p.style.left, p.style.top, p.style.width, p.style.height]).toEqual(['0px', '0px', '800px', '852px']);
    fire(tb, 'pointermove', 300, 400);
    expect(document.querySelector('.dsk-snap')).toBeNull();
    fire(tb, 'pointerup', 300, 400);
    expect(actions()).not.toContain('snap');
    expect(onMove).toHaveBeenCalled();
  });

  it('pointercancel di atas tepi: pratinjau hilang dan tidak ada snap', () => {
    render(base());
    const tb = titlebar();
    fire(tb, 'pointerdown', 800, 310);
    fire(tb, 'pointermove', 2, 400);
    expect(document.querySelector('.dsk-snap')).not.toBeNull();
    fire(tb, 'pointercancel', 2, 400);
    expect(document.querySelector('.dsk-snap')).toBeNull();
    expect(actions()).not.toContain('snap');
  });

  it('tanpa dispatch: tidak ada pratinjau dan jendela maksimal tidak bisa ditarik (perilaku lama)', () => {
    render(base(), false);
    fire(titlebar(), 'pointerdown', 800, 310);
    fire(titlebar(), 'pointermove', 2, 400);
    expect(document.querySelector('.dsk-snap')).toBeNull();
    render(base({ maximized: true }), false);
    fire(titlebar(), 'pointerdown', 800, 20);
    fire(titlebar(), 'pointermove', 900, 200);
    expect(onMove).not.toHaveBeenCalledWith(expect.anything(), 200);
  });

  it('menyeret titlebar jendela maksimal: dipulihkan ke ukuran semula dengan posisi relatif horizontal kursor terjaga', () => {
    render(base({ maximized: true, w: 600, h: 400 }));   // rect normal 600x400; tampil 1600 lebar
    const tb = titlebar();
    fire(tb, 'pointerdown', 800, 20);                    // tengah (rasio 0.5)
    fire(tb, 'pointermove', 802, 20);                    // di bawah ambang: belum lepas
    expect(actions()).not.toContain('restoreAt');
    fire(tb, 'pointermove', 820, 30);
    const call = dispatch.mock.calls.map(c => c[0] as WmAction).find(a => a.type === 'restoreAt') as Extract<WmAction, { type: 'restoreAt' }>;
    expect(call).toBeDefined();
    expect(call.x).toBe(Math.round(820 - 0.5125 * 600));  // rasio = (820-0)/1600
    fire(tb, 'pointerup', 820, 30);
  });

  it('menyeret jendela tertempel memulihkan rect pra-tempel', () => {
    render(base({ x: 0, y: 0, w: 800, h: 852, snapped: 'left', restore: { x: 300, y: 200, w: 640, h: 420 } }));
    const tb = titlebar();
    fire(tb, 'pointerdown', 400, 20);
    fire(tb, 'pointermove', 420, 40);
    const call = dispatch.mock.calls.map(c => c[0] as WmAction).find(a => a.type === 'restoreAt') as Extract<WmAction, { type: 'restoreAt' }>;
    expect(call.x).toBe(Math.round(420 - (420 / 800) * 640));
  });

  it('klik pada tombol titlebar tidak memulai geser; klik tanpa gerak pada titlebar tidak men-snap atau memindahkan', () => {
    render(base());
    const btn = document.querySelector('.dsk-wb.x')!;
    fire(btn, 'pointerdown', 1500, 20);
    fire(btn, 'pointerup', 1500, 20);
    expect(onMove).not.toHaveBeenCalled();
    expect(actions()).not.toContain('snap');
    fire(titlebar(), 'pointerdown', 800, 310);
    fire(titlebar(), 'pointerup', 800, 310);
    expect(actions()).not.toContain('snap');
  });

  it('klik tanpa bergerak (titlebar atau pegangan) tidak mengirim settle; lostpointercapture membatalkan pratinjau', () => {
    render(base());
    fire(titlebar(), 'pointerdown', 800, 310);
    fire(titlebar(), 'pointerup', 800, 310);
    fire(handle('e'), 'pointerdown', 500, 400);
    fire(handle('e'), 'pointerup', 500, 400);
    expect(actions()).not.toContain('settle');
    expect(onResize).not.toHaveBeenCalled();
    const tb = titlebar();
    fire(tb, 'pointerdown', 800, 310);
    fire(tb, 'pointermove', 2, 400);
    expect(document.querySelector('.dsk-snap')).not.toBeNull();
    act(() => { tb.dispatchEvent(new Event('lostpointercapture', { bubbles: true })); });
    expect(document.querySelector('.dsk-snap')).toBeNull();
    expect(actions()).not.toContain('snap');
  });
});
