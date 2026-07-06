'use client';

import { Rows3, LayoutGrid } from 'lucide-react';
import type { ViewMode } from '@/lib/useViewMode';

export default function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const btn = (active: boolean) => ({
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
  });

  return (
    <div className="inline-flex items-center rounded-xl p-1 gap-0.5 flex-shrink-0"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <button
        onClick={() => onChange('table')}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        style={btn(mode === 'table')}
        title="Tampilan tabel"
      >
        <Rows3 size={14} /> <span className="hidden sm:inline">Tabel</span>
      </button>
      <button
        onClick={() => onChange('card')}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        style={btn(mode === 'card')}
        title="Tampilan kartu"
      >
        <LayoutGrid size={14} /> <span className="hidden sm:inline">Kartu</span>
      </button>
    </div>
  );
}
