// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { handleShortcut, type ShortcutCtx } from './use-desktop-shortcuts';

const mk = (): ShortcutCtx => ({
  windows: [
    { tabId: 'a', minimized: false, maximized: false },
    { tabId: 'b', minimized: false, maximized: false },
  ],
  focusedTab: 'a', focus: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(), snap: vi.fn(), openSearch: vi.fn(),
});
const ev = (code: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { code, altKey: true, bubbles: true, cancelable: true, ...init });

// Menahan Alt+W menghasilkan keydown berulang (e.repeat = true). Tiap pengulangan menutup/mengecilkan jendela yang KEBETULAN sedang aktif, jadi
// menahan tombol sedetik menutup semua jendela (data belum tersimpan di tab lain ikut hilang).
describe('handleShortcut: auto-repeat (tombol ditahan)', () => {
  it.each([['KeyW', 'close'], ['KeyM', 'minimize'], ['Enter', 'maximize']] as const)('Alt+%s dengan e.repeat tidak boleh memanggil %s lagi', (code, fn) => {
    const c = mk();
    handleShortcut(ev(code, { repeat: true }), c);
    expect(c[fn]).not.toHaveBeenCalled();
  });

  it('keydown pertama (bukan repeat) tetap menjalankan aksi', () => {
    const c = mk();
    expect(handleShortcut(ev('KeyW'), c)).toBe(true);
    expect(c.close).toHaveBeenCalledWith('a');
  });
});

describe('handleShortcut: komposisi IME', () => {
  it('Alt+tombol saat e.isComposing tidak ditangani (tidak mencuri tombol dari IME)', () => {
    const c = mk();
    expect(handleShortcut(ev('KeyJ', { isComposing: true }), c)).toBe(false);
    expect(c.focus).not.toHaveBeenCalled();
  });
});
