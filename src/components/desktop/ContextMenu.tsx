'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';

export interface MenuItem {
  id: string;
  label?: string;
  Icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  /** Tampilkan centang (item pilihan). */
  checked?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

export interface ContextMenuBounds { w: number; h: number; top: number; bottom: number }

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  /** Area kerja layar: menu dijepit di dalamnya (tidak keluar ke taskbar/dock/menu bar). */
  bounds?: ContextMenuBounds;
  /** Elemen pemicu: fokus dikembalikan ke sini saat menu tertutup. */
  returnFocus?: HTMLElement | null;
  label?: string;
  onClose: () => void;
}

const MARGIN = 6;
const actionable = (it: MenuItem) => !it.separator && !it.disabled;

// Jepit posisi menu (lebar w, tinggi h) di dalam area kerja. Murni, dipakai juga oleh tes.
export function clampMenuPosition(x: number, y: number, w: number, h: number, b: ContextMenuBounds) {
  const left = Math.max(MARGIN, Math.min(x, b.w - w - MARGIN));
  const top = Math.max(b.top + MARGIN, Math.min(y, b.h - b.bottom - h - MARGIN));
  return { left, top };
}

// Menu klik kanan generik: muncul di posisi kursor, dijepit ke area kerja, navigasi keyboard penuh (panah, Home/End, Enter/Spasi, Esc, huruf pertama),
// menutup saat klik di luar / gulir / resize / blur, mengembalikan fokus ke pemicu. Gaya mengikuti token tema (ikut aksen Personalisasi).
export default function ContextMenu({ x, y, items, bounds, returnFocus, label = 'Menu konteks', onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const firstEnabled = items.findIndex(actionable);
  const [active, setActive] = useState(firstEnabled);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const b = bounds ?? { w: typeof window === 'undefined' ? 1280 : window.innerWidth, h: typeof window === 'undefined' ? 720 : window.innerHeight, top: 0, bottom: 0 };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(clampMenuPosition(x, y, r.width, r.height, b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, items.length, b.w, b.h, b.top, b.bottom]);

  useEffect(() => { itemRefs.current[active]?.focus(); }, [active]);

  // Tutup: klik di luar, gulir, resize, blur jendela. Satu menu per waktu dijamin pemilik state (DesktopShell).
  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const close = () => onClose();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  // Fokus kembali ke pemicu saat menu dilepas.
  useEffect(() => () => { if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true }); }, [returnFocus]);

  const move = useCallback((dir: 1 | -1) => {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = (active + dir * k + n * 2) % n;
      if (actionable(items[i])) { setActive(i); return; }
    }
  }, [items, active]);

  const choose = (it: MenuItem) => { if (!actionable(it)) return; onClose(); it.onSelect?.(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); onClose(); return;
      case 'ArrowDown': e.preventDefault(); move(1); return;
      case 'ArrowUp': e.preventDefault(); move(-1); return;
      case 'Home': e.preventDefault(); setActive(items.findIndex(actionable)); return;
      case 'End': { e.preventDefault(); for (let i = items.length - 1; i >= 0; i--) if (actionable(items[i])) { setActive(i); break; } return; }
      case 'Enter': case ' ': { e.preventDefault(); const it = items[active]; if (it) choose(it); return; }
      case 'Tab': e.preventDefault(); onClose(); return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ch = e.key.toLowerCase();
      const n = items.length;
      for (let k = 1; k <= n; k++) {
        const i = (active + k) % n;
        if (actionable(items[i]) && items[i].label?.toLowerCase().startsWith(ch)) { setActive(i); return; }
      }
    }
  };

  return (
    <div ref={ref} className="dsk-ctx" role="menu" aria-label={label} style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) => it.separator ? (
        <hr key={it.id} className="dsk-ctx-sep" role="separator" />
      ) : (
        <button key={it.id} ref={el => { itemRefs.current[i] = el; }} type="button" className="dsk-ctx-item" role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
          aria-checked={it.checked} aria-disabled={it.disabled || undefined} disabled={it.disabled} data-danger={it.danger || undefined}
          tabIndex={i === active ? 0 : -1} onMouseEnter={() => { if (actionable(it)) setActive(i); }} onClick={() => choose(it)}>
          <span className="dsk-ctx-ico">{it.checked ? <Check size={14} /> : it.Icon ? <it.Icon size={14} /> : null}</span>
          <span className="dsk-ctx-lbl">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

// Titik muncul menu dari event contextmenu. Peramban memicu contextmenu juga dari tombol Menu / Shift+F10 pada elemen terfokus, dengan koordinat (0,0)
// atau tengah elemen: bila (0,0) pakai pojok kiri-bawah elemen pemicu.
export function menuPointFromEvent(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
  if (e.clientX === 0 && e.clientY === 0) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  }
  return { x: e.clientX, y: e.clientY };
}
