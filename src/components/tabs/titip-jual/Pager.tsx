'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import PageSizeSelect from '@/components/PageSizeSelect';

// Paginasi bernomor yang sama dengan menu lain (Supplier, Mitra, dst).
export default function Pager({ total, noun, page, totalPages, pageSize, onPage, onPageSize }: {
  total: number; noun: string; page: number; totalPages: number; pageSize: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void;
}) {
  if (total === 0) return null;
  const go = (p: number) => onPage(Math.max(1, Math.min(p, totalPages)));
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} {noun} · halaman {page} dari {totalPages}</p>
        <PageSizeSelect value={pageSize} onChange={onPageSize} />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Tooltip label="Halaman sebelumnya">
            <button onClick={() => go(page - 1)} disabled={page === 1} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft size={14} /></button>
          </Tooltip>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
            .reduce<(number | '…')[]>((acc, n, i, arr) => {
              if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
              acc.push(n); return acc;
            }, [])
            .map((n, i) => n === '…'
              ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
              : <button key={n} onClick={() => go(n as number)} className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                  style={page === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>{n}</button>)}
          <Tooltip label="Halaman berikutnya">
            <button onClick={() => go(page + 1)} disabled={page === totalPages} className="btn-ghost p-2 disabled:opacity-30"><ChevronRight size={14} /></button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
