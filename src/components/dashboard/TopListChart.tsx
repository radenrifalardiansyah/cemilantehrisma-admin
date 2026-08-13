'use client';

import { useState } from 'react';

export interface TopListItem { label: string; value: number; emoji?: string; sub?: string }

// Ranked horizontal bar list — dipakai dashboard utama (menu/kategori/produk terpopuler) dan
// section Analitik Bisnis (bahan baku ternilai tertinggi). Diekstrak dari page.tsx supaya dipakai
// ulang tanpa duplikasi.
export default function TopListChart({ items, color, formatValue }: { items: TopListItem[]; color: string; formatValue?: (v: number) => string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const max = Math.max(...items.map(i => i.value), 1);
  const fmt = formatValue ?? ((v: number) => v.toLocaleString('id'));
  return (
    <div className="space-y-3.5">
      {items.map((it, i) => {
        const pct = Math.round((it.value / max) * 100);
        const active = hoverIdx === i;
        return (
          <div key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-xs font-semibold flex items-center gap-1.5 truncate min-w-0"
                style={{ color: active ? color : 'var(--text-secondary)' }}>
                {it.emoji && <span className="flex-shrink-0">{it.emoji}</span>}
                <span className="truncate">{it.label}</span>
              </span>
              <span className="text-xs font-bold tabular flex-shrink-0" style={{ color: active ? color : 'var(--text-primary)' }}>
                {fmt(it.value)}{it.sub ? <span className="font-medium opacity-60 ml-1">{it.sub}</span> : null}
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--border-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${pct}%`, background: color, opacity: active ? 1 : 0.72 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
