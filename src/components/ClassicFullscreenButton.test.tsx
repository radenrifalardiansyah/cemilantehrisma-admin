// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ClassicFullscreenButton from './ClassicFullscreenButton';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fsEl: Element | null = null;
let host: HTMLDivElement; let root: Root;
const enable = (v: boolean | undefined) => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => v });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
};
beforeEach(() => { fsEl = null; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); delete (document as unknown as Record<string, unknown>).fullscreenEnabled; delete (document as unknown as Record<string, unknown>).fullscreenElement; });

describe('ClassicFullscreenButton (header Klasik)', () => {
  it('didukung: tombol tampil hanya >= lg (hidden lg:flex), gaya tombol header Klasik; klik memanggil requestFullscreen; ikon dan label berganti', async () => {
    enable(true);
    const request = vi.fn(async () => { fsEl = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); });
    document.documentElement.requestFullscreen = request as unknown as () => Promise<void>;
    act(() => root.render(<ClassicFullscreenButton />));
    const btn = host.querySelector('button')!;
    expect(btn.className).toContain('hidden'); expect(btn.className).toContain('lg:flex');
    expect(btn.className).toContain('h-9'); expect(btn.className).toContain('w-9');
    expect(btn.style.border).toContain('var(--border)');
    expect(btn.getAttribute('aria-label')).toBe('Layar penuh'); expect(btn.getAttribute('aria-pressed')).toBe('false');
    await act(async () => { btn.click(); });
    expect(request).toHaveBeenCalledTimes(1);
    const after = host.querySelector('button')!;
    expect(after.getAttribute('aria-label')).toBe('Keluar dari layar penuh'); expect(after.getAttribute('aria-pressed')).toBe('true');
    expect(after.className).toBe(btn.className);   // ukuran sama: tidak ada layout shift saat ikon berganti
  });
  it('tidak didukung: tombol tersembunyi (tidak dirender)', () => {
    enable(false);
    act(() => root.render(<ClassicFullscreenButton />));
    expect(host.querySelector('button')).toBeNull();
  });
});
