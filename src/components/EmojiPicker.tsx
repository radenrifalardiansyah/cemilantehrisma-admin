'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag } from 'lucide-react';

const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Toko',       items: ['🛍️', '🏷️', '📦', '🛒', '💰', '⭐️', '🔥', '🆕', '🎁', '📋', '💵', '🏆'] },
  { label: 'Cemilan',    items: ['🍿', '🍟', '🍔', '🌭', '🥪', '🌮', '🌯', '🍕', '🥟', '🍢', '🍡', '🍤', '🍙', '🍘', '🍥', '🥠'] },
  { label: 'Makanan',    items: ['🍝', '🍜', '🍲', '🍛', '🍣', '🍚', '🍱', '🥗', '🍳', '🥘', '🍠', '🥔'] },
  { label: 'Kue & Manis', items: ['🍪', '🍩', '🍰', '🎂', '🧁', '🍮', '🍫', '🍬', '🍭', '🍧', '🍨', '🍦', '🥧', '🍯'] },
  { label: 'Buah',       items: ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🍅'] },
  { label: 'Minuman',    items: ['☕', '🍵', '🧃', '🥤', '🧋', '🥛', '🍺', '🍷'] },
  { label: 'Lainnya',    items: ['🥜', '🌰', '🍄', '🌽', '🥕', '🧄', '🧅', '🌾', '🥐', '🍞', '🥖', '🧀'] },
];

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  size?: number;
}

export default function EmojiPicker({ value, onChange, size = 44 }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWidth = 268;

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
          justifyContent: 'center', fontSize: size * 0.5, lineHeight: 1,
          cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: open ? '0 0 0 3px rgba(212,105,30,0.12)' : undefined,
          borderColor: open ? 'var(--accent)' : undefined,
          color: 'var(--text-muted)',
        }}
      >
        {value || <Tag size={size * 0.4} />}
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
          {EMOJI_GROUPS.map(g => (
            <div key={g.label} style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                {g.label}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
                {g.items.map(em => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => { onChange(em); setOpen(false); }}
                    style={{
                      fontSize: 18, lineHeight: 1, padding: 5, borderRadius: 8,
                      background: em === value ? 'var(--accent-bg)' : 'transparent',
                      border: 'none', cursor: 'pointer',
                    }}
                    onMouseEnter={e => { if (em !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                    onMouseLeave={e => { if (em !== value) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
