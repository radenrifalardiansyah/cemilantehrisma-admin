'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ICON_NAMES, resolveIcon } from '@/lib/icon-registry';

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  size?: number;
}

export default function IconPicker({ value, onChange, size = 44 }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWidth = 268;
  const current = { Icon: resolveIcon(value) };

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      let left = r.left;
      if (left + panelWidth > window.innerWidth - 12) left = Math.max(12, window.innerWidth - panelWidth - 12);
      let top = r.bottom + 6;
      if (top + 320 > window.innerHeight - 12) top = Math.max(12, r.top - 320 - 6);
      setPos({ top, left });
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
        style={{
          width: size, height: size, flexShrink: 0, boxSizing: 'border-box',
          borderRadius: 12, border: '1.5px solid var(--border)',
          background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: open ? '0 0 0 3px rgba(212,105,30,0.12)' : undefined,
          borderColor: open ? 'var(--accent)' : undefined,
          color: 'var(--text-secondary)',
        }}
      >
        <current.Icon size={size * 0.5} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: panelWidth,
            zIndex: 10000, background: 'var(--surface)', border: '1.5px solid var(--border)',
            borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.22)', padding: 12,
            maxHeight: 320, overflowY: 'auto',
          }}
          className="thin-scrollbar"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
            {ICON_NAMES.map(name => {
              const Icon = resolveIcon(name);
              const active = name === value;
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => { onChange(name); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 8, borderRadius: 8,
                    background: active ? 'var(--accent-bg)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    border: 'none', cursor: 'pointer',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
