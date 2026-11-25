// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Trash2 } from 'lucide-react';
import ContextMenu, { clampMenuPosition, menuPointFromEvent, type MenuItem } from './ContextMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });
const render = (n: ReactNode) => act(() => root.render(n));
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); });
const menu = () => document.querySelector<HTMLElement>('[role="menu"]')!;
const items = () => Array.from(menu().querySelectorAll<HTMLElement>('[role^="menuitem"]'));

const base = (extra: Partial<MenuItem>[] = [], onSelect = vi.fn()): MenuItem[] => [
  { id: 'a', label: 'Buka', onSelect },
  { id: 'b', label: 'Kecilkan', disabled: true },
  { id: 'sep', separator: true },
  { id: 'c', label: 'Tutup', Icon: Trash2, danger: true, onSelect },
  { id: 'd', label: 'Pilihan', checked: true, onSelect },
  ...extra as MenuItem[],
];

describe('clampMenuPosition', () => {
  const b = { w: 1000, h: 700, top: 28, bottom: 66 };
  it('di dalam area: tidak berubah; melewati kanan/bawah: dijepit; tidak masuk ke menu bar/dock', () => {
    expect(clampMenuPosition(100, 100, 200, 150, b)).toEqual({ left: 100, top: 100 });
    expect(clampMenuPosition(950, 100, 200, 150, b).left).toBe(1000 - 200 - 6);
    expect(clampMenuPosition(100, 690, 200, 150, b).top).toBe(700 - 66 - 150 - 6);
    expect(clampMenuPosition(-50, 0, 200, 150, b)).toEqual({ left: 6, top: 28 + 6 });
  });
});

describe('menuPointFromEvent', () => {
  it('koordinat nyata dipakai; (0,0) dari tombol Menu/Shift+F10 memakai pojok kiri-bawah elemen pemicu', () => {
    const el = document.createElement('button'); document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: 10, bottom: 50, top: 20, right: 40, width: 30, height: 30, x: 10, y: 20, toJSON() {} }) as DOMRect;
    expect(menuPointFromEvent({ clientX: 120, clientY: 80, currentTarget: el })).toEqual({ x: 120, y: 80 });
    expect(menuPointFromEvent({ clientX: 0, clientY: 0, currentTarget: el })).toEqual({ x: 10, y: 50 });
  });
});

describe('ContextMenu', () => {
  it('role menu/menuitem, separator, item disabled, centang sebagai menuitemcheckbox, fokus awal di item pertama yang aktif', () => {
    render(<ContextMenu x={10} y={10} items={base()} onClose={() => {}} />);
    expect(menu().getAttribute('role')).toBe('menu');
    expect(items().map(i => i.getAttribute('role'))).toEqual(['menuitem', 'menuitem', 'menuitem', 'menuitemcheckbox']);
    expect(menu().querySelector('[role="separator"]')).not.toBeNull();
    expect((items()[1] as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
    expect(items()[3].getAttribute('aria-checked')).toBe('true');
  });

  it('panah atas/bawah melompati item disabled dan melingkar; Home/End; huruf pertama', () => {
    render(<ContextMenu x={10} y={10} items={base()} onClose={() => {}} />);
    key(menu(), 'ArrowDown'); expect(document.activeElement).toBe(items()[2]);     // Kecilkan (disabled) dilewati -> Tutup
    key(menu(), 'ArrowDown'); expect(document.activeElement).toBe(items()[3]);
    key(menu(), 'ArrowDown'); expect(document.activeElement).toBe(items()[0]);     // melingkar
    key(menu(), 'ArrowUp'); expect(document.activeElement).toBe(items()[3]);
    key(menu(), 'Home'); expect(document.activeElement).toBe(items()[0]);
    key(menu(), 'End'); expect(document.activeElement).toBe(items()[3]);
    key(menu(), 't'); expect(document.activeElement).toBe(items()[2]);              // huruf pertama "T"utup
  });

  it('Enter dan Spasi memilih item aktif, menutup menu, lalu memanggil aksinya; item disabled tidak bisa dipilih', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={base([], onSelect)} onClose={onClose} />);
    key(menu(), 'Enter');
    expect(onClose).toHaveBeenCalledTimes(1); expect(onSelect).toHaveBeenCalledTimes(1);
    key(menu(), 'ArrowDown'); key(menu(), ' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
    act(() => items()[1].click());
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('Esc menutup; klik di luar menutup; klik di dalam menu tidak menutup lewat jalur klik-luar; resize dan blur menutup', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={base()} onClose={onClose} />);
    key(menu(), 'Escape'); expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    act(() => menu().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('resize')); }); expect(onClose).toHaveBeenCalledTimes(2);
    act(() => { window.dispatchEvent(new Event('blur')); }); expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('fokus dikembalikan ke elemen pemicu saat menu dilepas; klik kanan di atas menu tidak memunculkan menu bawaan', () => {
    const trigger = document.createElement('button'); document.body.appendChild(trigger);
    function Wrap() {
      const [open, setOpen] = useState(true);
      return <>{open && <ContextMenu x={10} y={10} items={base()} returnFocus={trigger} onClose={() => setOpen(false)} />}</>;
    }
    render(<Wrap />);
    expect(document.activeElement).not.toBe(trigger);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { menu().dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    key(menu(), 'Escape');
    expect(document.activeElement).toBe(trigger);
  });
});
