'use client';

import { useEffect, useRef } from 'react';

// Pintasan keyboard mode Desktop. Semua memakai Alt + tombol FISIK (event.code, jadi aman dari karakter khusus Option di Mac), tanpa Ctrl/Cmd, supaya
// tidak bertabrakan dengan pintasan peramban (Ctrl/Cmd+W/T/K/N...). Alt+Tab ditangkap sistem operasi, jadi pindah jendela memakai Alt+J.
export interface Shortcut { keys: string; label: string }
export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Alt + J', label: 'Pindah ke jendela berikutnya' },
  { keys: 'Alt + Shift + J', label: 'Pindah ke jendela sebelumnya' },
  { keys: 'Alt + W', label: 'Tutup jendela yang aktif' },
  { keys: 'Alt + M', label: 'Kecilkan jendela yang aktif' },
  { keys: 'Alt + Enter', label: 'Maksimalkan / pulihkan jendela' },
  { keys: 'Alt + ←', label: 'Tempel jendela ke kiri' },
  { keys: 'Alt + →', label: 'Tempel jendela ke kanan' },
  { keys: 'Alt + ↑', label: 'Maksimalkan jendela' },
  { keys: 'Alt + ↓', label: 'Pulihkan jendela maksimal (atau kecilkan bila sudah normal)' },
  { keys: 'Alt + K', label: 'Cari menu (buka Mulai / Launchpad)' },
  { keys: 'Esc', label: 'Tutup panel menu atau menu klik kanan' },
];

export interface ShortcutWindow { tabId: string; minimized: boolean; maximized: boolean; snapped?: boolean }

export interface ShortcutCtx {
  /** Urutan buka (sama dengan taskbar): dipakai untuk berpindah jendela. */
  windows: readonly ShortcutWindow[];
  /** Jendela terdepan (tidak diminimalkan), null bila tidak ada. */
  focusedTab: string | null;
  focus: (tab: string) => void;
  minimize: (tab: string) => void;
  maximize: (tab: string) => void;
  close: (tab: string) => void;
  /** Tempel ke tepi; tidak tersedia -> Alt+Panah kiri/kanan dilewatkan ke peramban. */
  snap?: (tab: string, side: 'left' | 'right' | 'top') => void;
  openSearch: () => void;
}

// Fokus di kolom isian atau elemen yang boleh diedit: pintasan tidak aktif (Alt+Panah dll. milik elemen itu).
function inEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

// Modal/dialog global terbuka: pintasan tidak aktif (kecuali panel menu Mulai/Launchpad sendiri, yang memang bagian dari desktop).
function modalOpen(): boolean {
  return !!document.querySelector('.modal-overlay, [role="alertdialog"], [role="dialog"]:not(.dsk-menu)');
}

// Mengembalikan true bila event ditangani (pemanggil lalu preventDefault). Murni terhadap `ctx` sehingga mudah diuji.
export function handleShortcut(e: KeyboardEvent, ctx: ShortcutCtx): boolean {
  if (e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;     // komposisi IME: jangan curi tombol
  if (inEditable(e.target) || modalOpen()) return false;

  const wins = ctx.windows;
  const cur = ctx.focusedTab;
  const curWin = cur ? wins.find(w => w.tabId === cur) : undefined;
  // Tombol ditahan (e.repeat): kombinasi tetap "milik kita" (true -> preventDefault, mis. Alt+panah mundur/maju) tapi aksi tidak diulang.
  const run = (fn: () => void) => { if (!e.repeat) fn(); };

  switch (e.code) {
    case 'KeyJ': {
      if (wins.length === 0) return false;
      const i = cur ? wins.findIndex(w => w.tabId === cur) : -1;
      const dir = e.shiftKey ? -1 : 1;
      const next = wins[((i < 0 ? (dir === 1 ? -1 : 0) : i) + dir + wins.length) % wins.length];
      run(() => ctx.focus(next.tabId));
      return true;
    }
    case 'KeyK':
      if (e.shiftKey) return false;
      run(() => ctx.openSearch());
      return true;
    case 'KeyW': if (!cur || e.shiftKey) return false; run(() => ctx.close(cur)); return true;
    case 'KeyM': if (!cur || e.shiftKey) return false; run(() => ctx.minimize(cur)); return true;
    case 'Enter': case 'NumpadEnter': if (!cur) return false; run(() => ctx.maximize(cur)); return true;
    case 'ArrowLeft': case 'ArrowRight':
      if (!cur || !ctx.snap) return false;
      run(() => ctx.snap!(cur, e.code === 'ArrowLeft' ? 'left' : 'right'));
      return true;
    case 'ArrowUp':
      if (!cur) return false;
      if (curWin?.maximized) return true;                       // sudah maksimal: tidak ada yang berubah, tetap jangan biarkan peramban menggulir
      run(() => { if (ctx.snap) ctx.snap(cur, 'top'); else ctx.maximize(cur); });
      return true;
    case 'ArrowDown':
      if (!cur) return false;
      run(() => { if (curWin?.maximized) ctx.maximize(cur); else ctx.minimize(cur); });   // maksimal -> pulihkan; selain itu kecilkan
      return true;
    default:
      return false;
  }
}

export function useDesktopShortcuts(enabled: boolean, ctx: ShortcutCtx) {
  const ref = useRef(ctx);
  useEffect(() => { ref.current = ctx; });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => { if (handleShortcut(e, ref.current)) e.preventDefault(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
