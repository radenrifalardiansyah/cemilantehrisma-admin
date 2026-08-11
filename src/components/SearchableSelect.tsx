'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, CornerDownRight, Search } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Nesting level for tree-shaped option lists (e.g. sub-menu pickers) — 0 or omitted renders flat. */
  depth?: number;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
}

export default function SearchableSelect({
  value, onChange, options, placeholder = '— Pilih —', disabled,
  searchPlaceholder = 'Cari…', emptyLabel = 'Tidak ada hasil.',
}: SearchableSelectProps) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos]     = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef    = useRef<HTMLButtonElement>(null);
  const panelRef  = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const current = options.find(o => o.value === value);

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
    setQuery('');
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="input disabled:opacity-50"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left' }}
      >
        <span className="truncate" style={{ color: current ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width, minWidth: 220,
            zIndex: 10000, background: 'var(--surface)', border: '1.5px solid var(--border)',
            borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.22)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', maxHeight: 300,
          }}
        >
          <div style={{ position: 'relative', flexShrink: 0, padding: 8, borderBottom: '1px solid var(--border-2)' }}>
            <Search size={13} style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="input text-sm w-full"
              style={{ paddingLeft: 30, height: 32 }}
            />
          </div>
          <div className="thin-scrollbar" style={{ overflowY: 'auto', padding: 6 }}>
            {filtered.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</p>
            ) : filtered.map(o => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => { if (o.disabled) return; onChange(o.value); setOpen(false); }}
                  className="disabled:opacity-40"
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '8px 10px', paddingLeft: 10 + (o.depth ?? 0) * 18, borderRadius: 8, textAlign: 'left', fontSize: 13, fontWeight: 500,
                    background: active ? 'var(--accent-bg)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    border: 'none', cursor: o.disabled ? 'not-allowed' : 'pointer',
                  }}
                  onMouseEnter={e => { if (!active && !o.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <span className="truncate" style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    {(o.depth ?? 0) > 0 && <CornerDownRight size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                    <span className="truncate">{o.label}</span>
                  </span>
                  {active && <Check size={13} />}
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
