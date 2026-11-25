'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useEscapeLayer } from '@/components/Modal';

// Deretan menu ala macOS (role="menubar"): klik membuka, hover ke menu lain saat ada yang terbuka berpindah, panah kiri/kanan antar menu,
// panah atas/bawah antar item, Enter memilih, Esc/klik di luar menutup. Dropdown absolut di bawah menu bar (tanpa backdrop-filter/transform).
export type MenuEntry =
  | { kind: 'item'; id: string; label: string; onSelect: () => void; disabled?: boolean; checked?: boolean; role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'; danger?: boolean }
  | { kind: 'sep'; id: string }
  | { kind: 'label'; id: string; label: string };

export interface MenuDef {
  id: string;
  /** Teks pemicu (bila `trigger` ada, ini jadi aria-label). */
  label: string;
  trigger?: ReactNode;
  /** Label tebal tanpa dropdown (nama aplikasi aktif); dilewati navigasi keyboard. */
  staticLabel?: boolean;
  entries?: MenuEntry[];
}

const ITEM_SEL = '[role^="menuitem"]:not(:disabled)';

function EscClose({ onEsc }: { onEsc: () => void }) { useEscapeLayer(onEsc); return null; }

function Dropdown({ def, onSelect, focusOn }: { def: MenuDef; onSelect: (e: MenuEntry & { kind: 'item' }) => void; focusOn: 'first' | 'last' | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  // Jepit ke dalam layar (tepi kanan); tinggi dibatasi lewat CSS (max-height + gulir).
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 8) setShift(window.innerWidth - 8 - r.right);
  }, []);
  useEffect(() => {
    if (!focusOn) return;
    const items = ref.current?.querySelectorAll<HTMLElement>(ITEM_SEL);
    if (items?.length) items[focusOn === 'first' ? 0 : items.length - 1].focus();
  }, [focusOn]);
  return (
    <div ref={ref} className="dsk-mdrop" role="menu" aria-label={def.label} style={shift ? { marginLeft: shift } : undefined}>
      {def.entries?.map(en => {
        if (en.kind === 'sep') return <hr key={en.id} role="separator" />;
        if (en.kind === 'label') return <div key={en.id} className="hd" role="presentation">{en.label}</div>;
        const role = en.role ?? 'menuitem';
        return (
          <button key={en.id} type="button" role={role} className={en.danger ? 'danger' : undefined} disabled={en.disabled}
            aria-checked={role === 'menuitem' ? undefined : !!en.checked} onClick={() => onSelect(en)}>
            <span className="ck" aria-hidden="true">{en.checked && <Check size={13} strokeWidth={2.5} />}</span>
            <span className="lbl">{en.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function MenuBarMenus({ menus }: { menus: MenuDef[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusOn, setFocusOn] = useState<'first' | 'last' | null>(null);
  const [rove, setRove] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const trigs = useRef(new Map<string, HTMLButtonElement>());
  const list = menus.filter(m => !m.staticLabel);

  const openMenu = (id: string, f: 'first' | 'last' | null = null) => { setOpenId(id); setFocusOn(f); };
  // Urutan penting: fokus dikembalikan ke pemicu SEBELUM aksi dijalankan; aksi yang membuka dialog/modal mengambil fokus sesudahnya (dan modal mencatat pemicu ini untuk memulihkan fokus saat ditutup).
  const closeAndFocus = () => { if (openId) trigs.current.get(openId)?.focus(); setOpenId(null); };

  // Klik di luar menu bar menutup dropdown (listener hanya ada selama terbuka dan dibersihkan saat tutup/unmount).
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpenId(null); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [openId]);

  const step = (from: number, dir: 1 | -1, f: 'first' | null) => {
    const i = (from + dir + list.length) % list.length;
    setRove(i);
    if (openId) openMenu(list[i].id, f);
    if (!f) trigs.current.get(list[i].id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const drop = t.closest<HTMLElement>('[role="menu"]');
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (drop) {
      const items = Array.from(drop.querySelectorAll<HTMLElement>(ITEM_SEL));
      const at = items.indexOf(t);
      const cur = list.findIndex(m => m.id === openId);
      if (e.key === 'ArrowDown') { handled(); items[(at + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { handled(); items[(at - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === 'Home') { handled(); items[0]?.focus(); }
      else if (e.key === 'End') { handled(); items[items.length - 1]?.focus(); }
      else if (e.key === 'ArrowRight' && cur >= 0) { handled(); step(cur, 1, 'first'); }
      else if (e.key === 'ArrowLeft' && cur >= 0) { handled(); step(cur, -1, 'first'); }
      else if (e.key === 'Tab') setOpenId(null);
      return;
    }
    const idx = list.findIndex(m => trigs.current.get(m.id) === t);
    if (idx < 0) return;
    if (e.key === 'ArrowRight') { handled(); step(idx, 1, null); }
    else if (e.key === 'ArrowLeft') { handled(); step(idx, -1, null); }
    else if (e.key === 'ArrowDown') { handled(); openMenu(list[idx].id, 'first'); }
    else if (e.key === 'ArrowUp') { handled(); openMenu(list[idx].id, 'last'); }
  };

  return (
    <div ref={rootRef} className="dsk-mmenus" role="menubar" aria-label="Menu aplikasi" onKeyDown={onKeyDown}>
      {menus.map(m => {
        if (m.staticLabel) return <span key={m.id} role="none" className="dsk-mapp"><b>{m.label}</b></span>;
        const i = list.indexOf(m);
        const open = openId === m.id;
        return (
          <div key={m.id} role="none" className="dsk-mwrap">
            <button type="button" role="menuitem" className="dsk-mtrig" aria-haspopup="menu" aria-expanded={open} aria-label={m.trigger ? m.label : undefined}
              tabIndex={i === rove ? 0 : -1} ref={el => { if (el) trigs.current.set(m.id, el); else trigs.current.delete(m.id); }}
              onFocus={() => setRove(i)}
              onClick={() => (open ? setOpenId(null) : openMenu(m.id))}
              onMouseEnter={() => { if (openId && !open) openMenu(m.id); }}>
              {m.trigger ?? m.label}
            </button>
            {open && <Dropdown def={m} focusOn={focusOn} onSelect={en => { closeAndFocus(); en.onSelect(); }} />}
          </div>
        );
      })}
      {openId && <EscClose onEsc={closeAndFocus} />}
    </div>
  );
}
