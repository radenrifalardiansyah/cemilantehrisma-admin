'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface ColorTheme { name: string; bgColor: string; gradient: string; }

export const PRODUCT_COLOR_THEMES: ColorTheme[] = [
  { name: 'Oranye',      bgColor: '#C2410C', gradient: 'from-orange-700 via-amber-600 to-yellow-400' },
  { name: 'Merah',       bgColor: '#BE123C', gradient: 'from-red-700 via-rose-600 to-orange-400' },
  { name: 'Kuning Emas', bgColor: '#B45309', gradient: 'from-amber-700 via-yellow-600 to-amber-400' },
  { name: 'Merah Pedas', bgColor: '#B91C1C', gradient: 'from-red-700 via-orange-600 to-red-400' },
  { name: 'Kuning',      bgColor: '#CA8A04', gradient: 'from-yellow-700 via-yellow-500 to-amber-300' },
  { name: 'Cokelat',     bgColor: '#92400E', gradient: 'from-amber-800 via-amber-600 to-yellow-500' },
  { name: 'Ungu',        bgColor: '#6D28D9', gradient: 'from-violet-700 via-purple-600 to-fuchsia-400' },
  { name: 'Merah Muda',  bgColor: '#9F1239', gradient: 'from-rose-700 via-pink-600 to-rose-400' },
  { name: 'Teal',        bgColor: '#0F766E', gradient: 'from-teal-700 via-cyan-600 to-emerald-400' },
  { name: 'Hijau',       bgColor: '#15803D', gradient: 'from-green-700 to-emerald-500' },
  { name: 'Biru',        bgColor: '#0369A1', gradient: 'from-sky-700 via-blue-600 to-cyan-400' },
  { name: 'Netral',      bgColor: '#57534E', gradient: 'from-stone-700 to-neutral-500' },
];

interface ColorThemePickerProps {
  bgColor: string;
  gradient: string;
  onChange: (theme: { bgColor: string; gradient: string }) => void;
}

export default function ColorThemePicker({ bgColor, gradient, onChange }: ColorThemePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const current = PRODUCT_COLOR_THEMES.find(t => t.gradient === gradient && t.bgColor === bgColor);

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      let top = r.bottom + 6;
      if (top + 280 > window.innerHeight - 12) top = Math.max(12, r.top - 280 - 6);
      setPos({ top, left: r.left, width: r.width });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="input"
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}
      >
        <span
          className={`bg-gradient-to-br ${gradient || 'from-amber-700 to-yellow-500'}`}
          style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, border: '1px solid rgba(0,0,0,0.08)' }}
        />
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? current.name : (gradient || 'Pilih warna')}
        </span>
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 220),
            zIndex: 10000, background: 'var(--surface)', border: '1.5px solid var(--border)',
            borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.22)', padding: 8,
            maxHeight: 280, overflowY: 'auto',
          }}
          className="thin-scrollbar"
        >
          {PRODUCT_COLOR_THEMES.map(t => {
            const active = t.gradient === gradient && t.bgColor === bgColor;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => { onChange({ bgColor: t.bgColor, gradient: t.gradient }); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: active ? 'var(--accent-bg)' : 'transparent',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <span
                  className={`bg-gradient-to-br ${t.gradient}`}
                  style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, border: '1px solid rgba(0,0,0,0.08)' }}
                />
                <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t.name}</span>
                {active && <Check size={14} style={{ color: 'var(--accent)' }} />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
