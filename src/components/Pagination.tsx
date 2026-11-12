'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import PageSizeSelect from '@/components/PageSizeSelect';
import Tooltip from '@/components/Tooltip';

/** Bilah paginasi bersama: ringkasan jumlah, pemilih ukuran halaman, dan tombol halaman. */
export default function Pagination({ total, safePage, totalPages, pageSize, onPageSize, onGoPage, unit }: {
  total: number; safePage: number; totalPages: number; pageSize: number;
  onPageSize: (n: number) => void; onGoPage: (p: number) => void; unit: string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {total} {unit} · halaman {safePage} dari {totalPages}
        </p>
        <PageSizeSelect value={pageSize} onChange={onPageSize} />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Tooltip label="Halaman sebelumnya">
            <button aria-label="Halaman sebelumnya" onClick={() => onGoPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
              <ChevronLeft size={14} />
            </button>
          </Tooltip>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
            .reduce<(number | '…')[]>((acc, n, i, arr) => {
              if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
              acc.push(n); return acc;
            }, [])
            .map((n, i) =>
              n === '…'
                ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                : <button key={n} onClick={() => onGoPage(n as number)}
                    className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                    style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                    {n}
                  </button>
            )
          }
          <Tooltip label="Halaman berikutnya">
            <button aria-label="Halaman berikutnya" onClick={() => onGoPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
              <ChevronRight size={14} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
