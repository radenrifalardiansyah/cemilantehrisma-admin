// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayoutDashboard } from 'lucide-react';
import DesktopShell, { type DesktopActions } from './DesktopShell';
import { useWindowManager } from './use-window-manager';
import type { DesktopGroup } from './types';
import { makeArea, type DesktopSkin } from './window-reducer';
import type { DesktopWidgetsApi } from './widgets/registry';
import { gridDims, widgetBox, PITCH } from '@/lib/widget-layout';
import { MAX_WIDGETS, type WidgetInstance } from '@/lib/widgets';

vi.mock('next/image', () => ({ default: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const groups: DesktopGroup[] = [{ id: 'm1', label: 'Utama', items: [{ tab: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard, color: '#D4691E', windowed: true, badge: 0 }] }];

const clock = (id = 'clk00001', col = 0, row = 0, size: 's' | 'm' = 's'): WidgetInstance => ({ id, type: 'clock', col, row, size, config: {} });
const note = (id = 'not00001', col = 2, row = 0, size: 'm' | 'l' = 'm', text = ''): WidgetInstance => ({ id, type: 'note', col, row, size, config: { text } });

const notes: string[] = [];
let lastList: readonly WidgetInstance[] = [];

function Harness({ skin = 'windows', initial = [], noApi = false, navTo }: { skin?: DesktopSkin; initial?: WidgetInstance[]; noApi?: boolean; navTo?: string }) {
  const { wm, dispatch } = useWindowManager({ enabled: true, skin, activeTab: navTo ?? 'dashboard', navNonce: navTo ? 1 : 0 });
  const [list, setList] = useState<WidgetInstance[]>(initial);
  useEffect(() => { lastList = list; });
  const api: DesktopWidgetsApi = {
    widgets: list,
    apply: m => { const n = m(list); if (!n) return false; setList(n); return true; },
    setConfig: (id, config) => setList(l => l.map(w => (w.id === id ? { ...w, config } : w))),
    notify: msg => { notes.push(msg); },
    creds: 'tok', can: () => true,
  };
  const actions: DesktopActions = {
    open: t => dispatch({ type: 'open', tabId: t }), focus: t => dispatch({ type: 'focus', tabId: t }), minimize: t => dispatch({ type: 'minimize', tabId: t }),
    maximize: t => dispatch({ type: 'maximize', tabId: t }), close: t => dispatch({ type: 'close', tabId: t }), move: (t, x, y) => dispatch({ type: 'move', tabId: t, x, y }),
    resize: (t, r) => dispatch({ type: 'resize', tabId: t, ...r }), arrange: () => dispatch({ type: 'arrange' }), closeAll: () => dispatch({ type: 'closeAll' }), dispatch,
  };
  return (
    <DesktopShell skin={skin} layout={skin} wm={wm} groups={groups} content={{ dashboard: <div>Isi</div> }} username="rifal" avatar={null} roleLabel="Admin" storeUrl="https://x"
      renderBell={() => <button aria-label="Notifikasi">bel</button>} actions={actions} widgets={noApi ? undefined : api}
      onPickMenu={() => {}} onChangeLayout={() => {}} onEditProfile={() => {}} onAbout={() => {}} onLogout={() => {}} />
  );
}

let host: HTMLDivElement; let root: Root;
let rafQueue: FrameRequestCallback[] = [];
beforeEach(() => {
  notes.length = 0; rafQueue = [];
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  HTMLElement.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; };
  if (!window.matchMedia) window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const render = (ui: ReactNode) => act(() => root.render(ui));
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qa = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
const flushRaf = () => act(() => { const q2 = rafQueue; rafQueue = []; q2.forEach(cb => cb(0)); });
const rightClick = (el: Element, x = 300, y = 300) => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  act(() => { el.dispatchEvent(ev); });
  return ev;
};
const ptr = (el: Element, type: string, x: number, y: number) => {
  const ev = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }), { pointerId: 1 });
  act(() => { el.dispatchEvent(ev); });
};
const key = (el: Element, init: KeyboardEventInit) => {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(ev); });
  return ev;
};
const card = (id: string) => q(`.dsk-wg[data-widget-id="${id}"]`)!;
const menuLabels = () => qa('.dsk-ctx-item').map(b => b.textContent ?? '');
const menuItem = (text: string) => qa('.dsk-ctx-item').find(b => b.textContent?.includes(text))!;
const typeInto = (el: HTMLTextAreaElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const vp = (skin: DesktopSkin) => gridDims(makeArea(window.innerWidth, window.innerHeight, skin));

describe('lapisan widget: kapan tampil', () => {
  it('tanpa pengelola widget atau tanpa widget: tidak ada lapisan sama sekali (tampilan sama persis)', () => {
    render(<Harness noApi />); expect(q('.dsk-wg-layer')).toBeNull();
    render(<Harness initial={[]} />); expect(q('.dsk-wg-layer')).toBeNull();
  });

  it.each(['windows', 'mac'] as const)('skin %s: kartu dirender dengan posisi grid (kolom dari kanan), judul dan isi', skin => {
    render(<Harness skin={skin} initial={[clock(), note('not00001', 2, 1, 'm', 'beli gula')]} />);
    expect(q('.dsk-wg-layer')).not.toBeNull();
    expect(qa('.dsk-wg')).toHaveLength(2);
    const b = widgetBox({ col: 0, row: 0, w: 2, h: 2 });
    expect(card('clk00001').style.right).toBe(`${b.right}px`);
    expect(card('clk00001').style.top).toBe(`${b.top}px`);
    expect(card('clk00001').style.width).toBe(`${b.width}px`);
    expect(card('clk00001').getAttribute('aria-label')).toBe('Jam & tanggal');
    expect(card('not00001').style.right).toBe(`${widgetBox({ col: 2, row: 1, w: 4, h: 2 }).right}px`);
    expect((card('not00001').querySelector('textarea') as HTMLTextAreaElement).value).toBe('beli gula');
  });

  it('lapisan di bawah ikon meja (urutan DOM) dan di bawah jendela (z-index jendela >= 1); wadah tidak menangkap klik', () => {
    render(<Harness initial={[clock()]} />);
    render(<Harness initial={[clock()]} navTo="dashboard" />);   // navNonce naik: membuka jendela
    const layer = q('.dsk-wg-layer')!;
    const icons = q('.dsk-icons')!;
    expect(layer.compareDocumentPosition(icons) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Number(q('.dsk-win')!.style.zIndex)).toBeGreaterThanOrEqual(1);
  });

  it('id/tipe tidak dikenal dan widget yang tidak muat disembunyikan tanpa menghapus data; kembali saat layar membesar', () => {
    const w0 = window.innerWidth;
    render(<Harness initial={[clock(), note('not00001', 2, 0, 'm')]} />);
    expect(qa('.dsk-wg')).toHaveLength(2);
    act(() => { window.innerWidth = 330; window.dispatchEvent(new Event('resize')); });
    expect(qa('.dsk-wg')).toHaveLength(1);            // catatan (4 sel) tidak muat di 2 kolom
    expect(lastList[1]).toMatchObject({ col: 2, row: 0, size: 'm' });   // data tersimpan tidak berubah
    act(() => { window.innerWidth = w0; window.dispatchEvent(new Event('resize')); });
    expect(qa('.dsk-wg')).toHaveLength(2);
    expect(card('not00001').style.right).toBe(`${widgetBox({ col: 2, row: 0, w: 4, h: 2 }).right}px`);
  });
});

describe('tambah widget lewat klik kanan wallpaper', () => {
  it('menu desktop memuat "Tambah widget: ..."; memilihnya menambah di slot bebas pertama; wallpaper tetap menu desktop', () => {
    render(<Harness />);
    rightClick(q('.dsk-root')!);
    expect(menuLabels()).toEqual(expect.arrayContaining(['Tambah widget: Jam & tanggal', 'Tambah widget: Catatan tempel']));
    expect(menuLabels().some(l => l.includes('Personalisasi') || l.includes('Pintasan keyboard'))).toBe(true);
    click(menuItem('Tambah widget: Jam & tanggal'));
    expect(q('.dsk-ctx')).toBeNull();
    expect(lastList).toHaveLength(1);
    expect(lastList[0]).toMatchObject({ type: 'clock', col: 0, row: 0, size: 's' });
    expect(qa('.dsk-wg')).toHaveLength(1);
    rightClick(q('.dsk-root')!);
    click(menuItem('Tambah widget: Catatan tempel'));
    expect(lastList[1]).toMatchObject({ type: 'note', col: 2, row: 0, size: 'm', config: { text: '' } });
    expect(lastList[1].id).toMatch(/^[a-z0-9]{8}$/);
  });

  it('klik kanan area kosong di antara widget (target = wallpaper) tetap menu desktop; klik kanan kartu = menu widget saja', () => {
    render(<Harness initial={[clock()]} />);
    rightClick(q('.dsk-root')!);
    expect(menuLabels().some(l => l.includes('Susun ulang'))).toBe(true);
    rightClick(card('clk00001'));
    expect(menuLabels().some(l => l.includes('Susun ulang'))).toBe(false);
    expect(menuLabels()).toEqual(['Ukuran Kecil', 'Ukuran Sedang', 'Hapus widget']);
  });

  it('tidak ada slot: item tambah disabled; 12 widget: semua disabled', () => {
    const full = [note('n1', 0, 0), note('n2', 4, 0), note('n3', 0, 2), note('n4', 4, 2)];
    render(<Harness initial={full} />);
    expect(vp('windows')).toEqual({ cols: 8, rows: 5 });
    rightClick(q('.dsk-root')!);
    expect((menuItem('Tambah widget: Jam & tanggal') as HTMLButtonElement).disabled).toBe(true);
    expect((menuItem('Tambah widget: Catatan tempel') as HTMLButtonElement).disabled).toBe(true);
  });

  it('12 widget: item tambah disabled walau ada tempat', () => {
    // 12 jam 2x2 di grid 8x5 tidak muat (maks 4x2=8); pakai posisi sama: yang tidak muat tersembunyi, tapi batas jumlah tetap berlaku.
    const many = Array.from({ length: MAX_WIDGETS }, (_, i) => clock(`c${i}`, 0, 0));
    render(<Harness initial={many} />);
    rightClick(q('.dsk-root')!);
    expect((menuItem('Tambah widget: Jam & tanggal') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('menu kartu widget', () => {
  it('ukuran: centang pada ukuran saat ini; Sedang mengubah ukuran; hanya ukuran yang diizinkan type', () => {
    render(<Harness initial={[clock()]} />);
    rightClick(card('clk00001'));
    expect(menuItem('Ukuran Kecil').getAttribute('aria-checked')).toBe('true');
    expect(menuItem('Ukuran Sedang').getAttribute('aria-checked')).toBe('false');
    expect(menuLabels().some(l => l.includes('Lebar'))).toBe(false);
    click(menuItem('Ukuran Sedang'));
    expect(lastList[0].size).toBe('m');
    expect(card('clk00001').getAttribute('data-size')).toBe('m');
    rightClick(card('clk00001'));
    expect(menuItem('Ukuran Sedang').getAttribute('aria-checked')).toBe('true');
  });

  it('ukuran baru tidak muat: ditolak dengan pesan "Ruang tidak cukup", daftar tidak berubah', () => {
    const ws = [clock('c1', 0, 0), note('l1', 2, 0, 'l'), note('m1', 2, 3, 'm')];
    render(<Harness initial={ws} />);
    rightClick(card('c1'));
    click(menuItem('Ukuran Sedang'));
    expect(notes).toEqual(['Ruang tidak cukup']);
    expect(lastList).toEqual(ws);
  });

  it('Hapus widget menghapus kartu', () => {
    render(<Harness initial={[clock(), note()]} />);
    rightClick(card('clk00001'));
    click(menuItem('Hapus widget'));
    expect(qa('.dsk-wg')).toHaveLength(1);
    expect(lastList.map(w => w.id)).toEqual(['not00001']);
  });

  it('tombol menu di header membuka menu yang sama; menghapus widget terakhir menghilangkan lapisan', () => {
    render(<Harness initial={[clock()]} />);
    click(card('clk00001').querySelector('.dsk-wg-menu'));
    expect(menuLabels()).toContain('Hapus widget');
    click(menuItem('Hapus widget'));
    expect(q('.dsk-wg-layer')).toBeNull();
  });
});

describe('klik kanan di dalam textarea', () => {
  it('tidak dicegat: menu bawaan peramban, tanpa menu kita', () => {
    render(<Harness initial={[note()]} />);
    const ev = rightClick(card('not00001').querySelector('textarea')!);
    expect(ev.defaultPrevented).toBe(false);
    expect(q('.dsk-ctx')).toBeNull();
  });
});

describe('catatan: mengetik', () => {
  it('mengubah config.text lewat pengelola; textarea mengikuti; maxLength 500', () => {
    render(<Harness initial={[note()]} />);
    const ta = card('not00001').querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(500);
    typeInto(ta, 'halo');
    expect(lastList[0].config).toEqual({ text: 'halo' });
    expect((card('not00001').querySelector('textarea') as HTMLTextAreaElement).value).toBe('halo');
  });
});

describe('seret kartu', () => {
  const startX = 500; const startY = 200;

  it('digeser ke sel kosong: pratinjau slot saat menyeret, posisi diperbarui saat dilepas (snap grid)', () => {
    render(<Harness initial={[clock()]} />);
    const c = card('clk00001');
    ptr(c, 'pointerdown', startX, startY);
    ptr(c, 'pointermove', startX - 2 * PITCH - 10, startY + PITCH + 5);
    flushRaf();
    const ghost = q('.dsk-wg-ghost')!;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('data-valid')).toBe('true');
    expect(ghost.style.right).toBe(`${widgetBox({ col: 2, row: 1, w: 2, h: 2 }).right}px`);
    expect(card('clk00001').getAttribute('data-dragging')).toBe('true');
    expect(card('clk00001').style.transform).toContain('translate(');
    ptr(c, 'pointerup', startX - 2 * PITCH - 10, startY + PITCH + 5);
    expect(lastList[0]).toMatchObject({ col: 2, row: 1 });
    expect(q('.dsk-wg-ghost')).toBeNull();
    expect(card('clk00001').style.transform).toBe('');
    expect(card('clk00001').style.right).toBe(`${widgetBox({ col: 2, row: 1, w: 2, h: 2 }).right}px`);
  });

  it('tujuan menimpa widget lain: pratinjau tidak valid, saat dilepas tidak berpindah', () => {
    render(<Harness initial={[clock('c1', 0, 0), note('n1', 2, 0)]} />);
    const c = card('c1');
    ptr(c, 'pointerdown', startX, startY);
    ptr(c, 'pointermove', startX - 2 * PITCH, startY);
    flushRaf();
    expect(q('.dsk-wg-ghost')!.getAttribute('data-valid')).toBe('false');
    ptr(c, 'pointerup', startX - 2 * PITCH, startY);
    expect(lastList[0]).toMatchObject({ col: 0, row: 0 });
  });

  it('tidak keluar area: dilepas jauh di luar dijepit ke tepi grid', () => {
    render(<Harness initial={[clock()]} />);
    const c = card('clk00001');
    ptr(c, 'pointerdown', startX, startY);
    ptr(c, 'pointermove', startX + 5000, startY - 5000);   // ke kanan-atas: kolom/baris negatif dijepit ke 0
    flushRaf();
    ptr(c, 'pointerup', startX + 5000, startY - 5000);
    expect(lastList[0]).toMatchObject({ col: 0, row: 0 });
    ptr(c, 'pointerdown', startX, startY);
    ptr(c, 'pointermove', startX - 5000, startY + 5000);
    flushRaf();
    ptr(c, 'pointerup', startX - 5000, startY + 5000);
    const g = vp('windows');
    expect(lastList[0]).toMatchObject({ col: g.cols - 2, row: g.rows - 2 });
  });

  it('klik tanpa bergerak (di bawah ambang) tidak menyeret atau mengubah posisi', () => {
    render(<Harness initial={[clock()]} />);
    const c = card('clk00001');
    ptr(c, 'pointerdown', startX, startY); ptr(c, 'pointermove', startX + 1, startY + 1); flushRaf(); ptr(c, 'pointerup', startX + 1, startY + 1);
    expect(q('.dsk-wg-ghost')).toBeNull();
    expect(lastList[0]).toMatchObject({ col: 0, row: 0 });
  });

  it('pointerdown pada textarea atau tombol menu TIDAK memulai seret', () => {
    render(<Harness initial={[note()]} />);
    const ta = card('not00001').querySelector('textarea')!;
    ptr(ta, 'pointerdown', startX, startY); ptr(ta, 'pointermove', startX - 300, startY); flushRaf();
    expect(q('.dsk-wg-ghost')).toBeNull();
    ptr(ta, 'pointerup', startX - 300, startY);
    expect(lastList[0]).toMatchObject({ col: 2, row: 0 });
    const btn = card('not00001').querySelector('.dsk-wg-menu')!;
    ptr(btn, 'pointerdown', startX, startY); ptr(btn, 'pointermove', startX - 300, startY); flushRaf();
    expect(q('.dsk-wg-ghost')).toBeNull();
  });

  it('pointercancel dan Esc membatalkan seretan tanpa mengubah posisi', () => {
    render(<Harness initial={[clock()]} />);
    const c = card('clk00001');
    ptr(c, 'pointerdown', startX, startY); ptr(c, 'pointermove', startX - 300, startY); flushRaf();
    expect(q('.dsk-wg-ghost')).not.toBeNull();
    ptr(c, 'pointercancel', startX - 300, startY);
    expect(q('.dsk-wg-ghost')).toBeNull(); expect(card('clk00001').style.transform).toBe('');
    expect(lastList[0]).toMatchObject({ col: 0, row: 0 });
    ptr(c, 'pointerdown', startX, startY); ptr(c, 'pointermove', startX - 300, startY); flushRaf();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(q('.dsk-wg-ghost')).toBeNull();
    ptr(c, 'pointerup', startX - 300, startY);
    expect(lastList[0]).toMatchObject({ col: 0, row: 0 });
  });

  it('tombol non-utama tidak memulai seret', () => {
    render(<Harness initial={[clock()]} />);
    const c = card('clk00001');
    act(() => { c.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 2, clientX: startX, clientY: startY }), { pointerId: 1 })); });
    ptr(c, 'pointermove', startX - 300, startY); flushRaf();
    expect(q('.dsk-wg-ghost')).toBeNull();
  });
});

describe('keyboard', () => {
  it('kartu fokusable; Alt+panah menggeser satu sel (kiri = kolom+1) dan mencegah pintasan jendela; ditolak di tepi', () => {
    render(<Harness initial={[clock('c1', 1, 1)]} navTo="dashboard" />);
    const c = card('c1');
    expect(c.tabIndex).toBe(0);
    c.focus();
    const ev = key(c, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(lastList[0]).toMatchObject({ col: 2, row: 1 });
    key(c, { key: 'ArrowRight', code: 'ArrowRight', altKey: true });
    key(c, { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    expect(lastList[0]).toMatchObject({ col: 1, row: 0 });
    key(c, { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    expect(lastList[0]).toMatchObject({ col: 1, row: 0 });   // sudah di tepi atas
    key(c, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
    expect(lastList[0]).toMatchObject({ col: 1, row: 1 });
  });

  it('panah tanpa Alt tidak menggeser; panah dari dalam textarea diabaikan', () => {
    render(<Harness initial={[note()]} />);
    key(card('not00001'), { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(lastList[0]).toMatchObject({ col: 2 });
    key(card('not00001').querySelector('textarea')!, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    expect(lastList[0]).toMatchObject({ col: 2 });
  });

  it('Delete, Shift+F10, dan tombol Menu membuka menu widget (hapus lewat menu)', () => {
    render(<Harness initial={[clock()]} />);
    const c = card('clk00001');
    key(c, { key: 'Delete', code: 'Delete' });
    expect(menuLabels()).toContain('Hapus widget');
    key(q('.dsk-ctx')!, { key: 'Escape' });
    expect(q('.dsk-ctx')).toBeNull();
    key(c, { key: 'F10', code: 'F10', shiftKey: true });
    expect(q('.dsk-ctx')).not.toBeNull();
    key(q('.dsk-ctx')!, { key: 'Escape' });
    key(c, { key: 'ContextMenu', code: 'ContextMenu' });
    expect(q('.dsk-ctx')).not.toBeNull();
    expect(lastList).toHaveLength(1);   // belum terhapus sebelum memilih item
  });
});

describe('active widget mengikuti "wallpaper terlihat"', () => {
  it('jendela maksimal yang tidak dikecilkan menutupi wallpaper: timer jam berhenti; dikecilkan/dipulihkan: berjalan lagi', () => {
    vi.useFakeTimers();
    try {
      render(<Harness initial={[clock()]} />);
      render(<Harness initial={[clock()]} navTo="dashboard" />);   // jendela Dashboard terbuka
      const running = vi.getTimerCount();
      click(q('.dsk-win .dsk-wb[aria-label="Besarkan"]'));            // maksimalkan
      expect(q('.dsk-win')!.getAttribute('data-max')).toBe('true');
      expect(vi.getTimerCount()).toBe(running - 2);                    // interval + penyegaran awal jam dibersihkan
      click(q('.dsk-win .dsk-wb[aria-label="Pulihkan"]'));            // pulihkan
      expect(vi.getTimerCount()).toBe(running);
    } finally { vi.useRealTimers(); }
  });
});
