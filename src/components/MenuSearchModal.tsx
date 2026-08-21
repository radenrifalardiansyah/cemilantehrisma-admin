'use client';

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search, X } from 'lucide-react';

export interface MenuSearchItem {
  id: string;
  label: string;
  Icon: LucideIcon;
}

interface Props {
  items: MenuSearchItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function MenuSearchModal({ items, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const results = q ? items.filter(i => i.label.toLowerCase().includes(q)) : items;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />

        <div className="modal-header">
          <div className="modal-header-left" style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-icon"><Search size={17} /></div>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Cari menu…"
              className="w-full"
              style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}
            />
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>

        <div className="modal-body thin-scrollbar" style={{ padding: 8 }}>
          {results.length === 0 ? (
            <p className="text-xs text-center" style={{ color: 'var(--text-muted)', padding: '28px 0' }}>
              Menu tidak ditemukan
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {results.map(item => (
                <button
                  key={item.id}
                  onClick={() => { onSelect(item.id); onClose(); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', borderRadius: 10, textAlign: 'left',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <item.Icon size={17} strokeWidth={1.8} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
