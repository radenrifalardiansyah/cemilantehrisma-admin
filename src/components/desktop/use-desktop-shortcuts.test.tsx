// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SHORTCUTS, handleShortcut, useDesktopShortcuts, type ShortcutCtx } from './use-desktop-shortcuts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (over: Partial<ShortcutCtx> = {}): ShortcutCtx => ({
  windows: [
    { tabId: 'a', minimized: false, maximized: false },
    { tabId: 'b', minimized: true, maximized: false },
    { tabId: 'c', minimized: false, maximized: false },
  ],
  focusedTab: 'a', focus: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(), snap: vi.fn(), openSearch: vi.fn(), ...over,
});
const ev = (code: string, init: KeyboardEventInit = {}, target?: Element) => {
  const e = new KeyboardEvent('keydown', { code, altKey: true, bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(e, 'target', { value: target });
  return e;
};

describe('handleShortcut: tiap kombinasi memanggil aksi yang benar', () => {
  it('Alt+J / Alt+Shift+J: jendela berikutnya/sebelumnya (melingkar, termasuk yang dikecilkan); tanpa fokus: berikutnya = jendela pertama, sebelumnya = jendela terakhir', () => {
    const c = mk(); expect(handleShortcut(ev('KeyJ'), c)).toBe(true); expect(c.focus).toHaveBeenCalledWith('b');
    const d = mk(); handleShortcut(ev('KeyJ', { shiftKey: true }), d); expect(d.focus).toHaveBeenCalledWith('c');
    const e = mk({ focusedTab: null }); handleShortcut(ev('KeyJ'), e); expect(e.focus).toHaveBeenCalledWith('a');
    const f = mk({ focusedTab: null }); handleShortcut(ev('KeyJ', { shiftKey: true }), f); expect(f.focus).toHaveBeenCalledWith('c');
    const none = mk({ windows: [], focusedTab: null }); expect(handleShortcut(ev('KeyJ'), none)).toBe(false);
  });
  it('Alt+W tutup, Alt+M kecilkan, Alt+Enter maksimalkan/pulihkan jendela aktif', () => {
    const c = mk();
    expect(handleShortcut(ev('KeyW'), c)).toBe(true); expect(c.close).toHaveBeenCalledWith('a');
    expect(handleShortcut(ev('KeyM'), c)).toBe(true); expect(c.minimize).toHaveBeenCalledWith('a');
    expect(handleShortcut(ev('Enter'), c)).toBe(true); expect(c.maximize).toHaveBeenCalledWith('a');
  });
  it('Alt+Panah: kiri/kanan tempel, atas maksimal (snap top), bawah pulihkan bila maksimal atau kecilkan', () => {
    const c = mk();
    handleShortcut(ev('ArrowLeft'), c); handleShortcut(ev('ArrowRight'), c); handleShortcut(ev('ArrowUp'), c);
    expect(c.snap).toHaveBeenNthCalledWith(1, 'a', 'left'); expect(c.snap).toHaveBeenNthCalledWith(2, 'a', 'right'); expect(c.snap).toHaveBeenNthCalledWith(3, 'a', 'top');
    handleShortcut(ev('ArrowDown'), c); expect(c.minimize).toHaveBeenCalledWith('a');
    const m = mk({ windows: [{ tabId: 'a', minimized: false, maximized: true }] });
    handleShortcut(ev('ArrowDown'), m); expect(m.maximize).toHaveBeenCalledWith('a'); expect(m.minimize).not.toHaveBeenCalled();
    expect(handleShortcut(ev('ArrowUp'), m)).toBe(true); expect(m.snap).not.toHaveBeenCalled();   // sudah maksimal
  });
  it('tanpa snap: Alt+Panah kiri/kanan dilewatkan ke peramban; Alt+Panah atas jatuh ke maksimalkan', () => {
    const c = mk({ snap: undefined });
    expect(handleShortcut(ev('ArrowLeft'), c)).toBe(false);
    handleShortcut(ev('ArrowUp'), c); expect(c.maximize).toHaveBeenCalledWith('a');
  });
  it('Alt+K membuka pencarian menu', () => {
    const c = mk(); expect(handleShortcut(ev('KeyK'), c)).toBe(true); expect(c.openSearch).toHaveBeenCalled();
  });
  it('tanpa jendela aktif: Alt+W/M/Enter/Panah tidak ditangani (peramban bebas)', () => {
    const c = mk({ focusedTab: null });
    for (const code of ['KeyW', 'KeyM', 'Enter', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) expect(handleShortcut(ev(code), c), code).toBe(false);
  });
  it('hanya Alt murni: Ctrl/Cmd+Alt, tanpa Alt, dan kombinasi tak dikenal tidak ditangani', () => {
    const c = mk();
    expect(handleShortcut(ev('KeyW', { ctrlKey: true }), c)).toBe(false);
    expect(handleShortcut(ev('KeyW', { metaKey: true }), c)).toBe(false);
    expect(handleShortcut(ev('KeyW', { altKey: false }), c)).toBe(false);
    expect(handleShortcut(ev('KeyZ'), c)).toBe(false);
    expect(c.close).not.toHaveBeenCalled();
  });
  it('tidak aktif saat fokus di input/textarea/select/contenteditable', () => {
    const c = mk();
    for (const tag of ['input', 'textarea', 'select']) expect(handleShortcut(ev('KeyW', {}, document.createElement(tag)), c), tag).toBe(false);
    const ce = document.createElement('div'); Object.defineProperty(ce, 'isContentEditable', { value: true });
    expect(handleShortcut(ev('KeyW', {}, ce), c)).toBe(false);
    expect(c.close).not.toHaveBeenCalled();
  });
  it('tidak aktif saat modal/dialog global terbuka; panel menu Mulai/Launchpad (.dsk-menu) tidak dianggap modal', () => {
    const c = mk();
    const modal = document.createElement('div'); modal.className = 'modal-overlay'; document.body.appendChild(modal);
    expect(handleShortcut(ev('KeyW'), c)).toBe(false);
    modal.remove();
    const panel = document.createElement('div'); panel.className = 'dsk-menu'; panel.setAttribute('role', 'dialog'); document.body.appendChild(panel);
    expect(handleShortcut(ev('KeyW'), c)).toBe(true);
    panel.remove();
    const alert = document.createElement('div'); alert.setAttribute('role', 'alertdialog'); document.body.appendChild(alert);
    expect(handleShortcut(ev('KeyW'), c)).toBe(false);
    alert.remove();
  });
  it('event yang sudah di-preventDefault tidak ditangani', () => {
    const c = mk(); const e = ev('KeyW'); e.preventDefault();
    expect(handleShortcut(e, c)).toBe(false);
  });
  it('daftar SHORTCUTS terdokumentasi memuat semua kombinasi yang ditangani', () => {
    const keys = SHORTCUTS.map(s => s.keys);
    for (const k of ['Alt + J', 'Alt + Shift + J', 'Alt + W', 'Alt + M', 'Alt + Enter', 'Alt + ←', 'Alt + →', 'Alt + ↑', 'Alt + ↓', 'Alt + K', 'Esc']) expect(keys).toContain(k);
  });
});

describe('useDesktopShortcuts: listener tunggal dengan cleanup', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  function H({ enabled, ctx }: { enabled: boolean; ctx: ShortcutCtx }) { useDesktopShortcuts(enabled, ctx); return null; }
  const render = (n: ReactNode) => act(() => root.render(n));
  const press = (code: string) => { const e = ev(code); document.dispatchEvent(e); return e; };

  it('aktif: kombinasi memanggil aksi dan e.preventDefault hanya untuk yang ditangani', () => {
    const c = mk(); render(<H enabled ctx={c} />);
    expect(press('KeyW').defaultPrevented).toBe(true); expect(c.close).toHaveBeenCalledWith('a');
    expect(press('KeyZ').defaultPrevented).toBe(false);
  });
  it('memakai ctx terbaru tanpa memasang ulang listener', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const c1 = mk(); render(<H enabled ctx={c1} />);
    const c2 = mk({ focusedTab: 'c' }); render(<H enabled ctx={c2} />);
    press('KeyW');
    expect(c1.close).not.toHaveBeenCalled(); expect(c2.close).toHaveBeenCalledWith('c');
    expect(add.mock.calls.filter(c => c[0] === 'keydown')).toHaveLength(1);
    add.mockRestore();
  });
  it('enabled=false (Klasik): tidak ada listener, tidak ada aksi', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const c = mk(); render(<H enabled={false} ctx={c} />);
    expect(add.mock.calls.filter(x => x[0] === 'keydown')).toHaveLength(0);
    press('KeyW'); expect(c.close).not.toHaveBeenCalled();
    add.mockRestore();
  });
  it('listener dilepas saat unmount', () => {
    const c = mk(); render(<H enabled ctx={c} />);
    act(() => root.unmount()); root = createRoot(host);
    press('KeyW'); expect(c.close).not.toHaveBeenCalled();
  });
});
