'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Check } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  height?: number;
  searchPlaceholder?: string;
  emptyLabel?: string;
}

export default function FilterSelect({
  value, onChange, options, height = 34, searchPlaceholder = 'Cari…', emptyLabel = 'Tidak ditemukan',
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value);
  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const panelH = 300;
      let top = r.bottom + 6;
      if (top + panelH > window.innerHeight - 12) top = Math.max(12, r.top - panelH - 6);
      setPos({ top, left: r.left, width: Math.max(r.width, 200) });
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
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => clearTimeout(t);
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
        className="input text-xs font-semibold"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', height,
          padding: '0 10px', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? `${selected.label}${selected.count != null ? ` (${selected.count})` : ''}` : '– Pilih –'}
        </span>
        <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
            zIndex: 10000, background: 'var(--surface)', border: '1.5px solid var(--border)',
            borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
            display: 'flex', flexDirection: 'column', maxHeight: 320, overflow: 'hidden',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-2)', position: 'relative', flexShrink: 0 }}>
            <Search size={13} style={{ position: 'absolute', left: 19, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="input"
              style={{ paddingLeft: 30, fontSize: 12.5, padding: '8px 10px 8px 30px' }}
            />
          </div>
          <div className="thin-scrollbar" style={{ overflowY: 'auto', padding: 6 }}>
            {filtered.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 8px' }}>{emptyLabel}</p>
            ) : filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '8px 10px', borderRadius: 9, border: 'none', textAlign: 'left',
                  background: o.value === value ? 'var(--accent-bg)' : 'transparent', cursor: 'pointer',
                }}
                onMouseEnter={e => { if (o.value !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                onMouseLeave={e => { if (o.value !== value) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label}{o.count != null ? ` (${o.count})` : ''}
                </span>
                {o.value === value && <Check size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
