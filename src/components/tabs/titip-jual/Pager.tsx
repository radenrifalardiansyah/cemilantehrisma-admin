'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import PageSizeSelect from '@/components/PageSizeSelect';

export default function Pager({ total, noun, page, totalPages, pageSize, onPage, onPageSize }: {
  total: number; noun: string; page: number; totalPages: number; pageSize: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} {noun} · halaman {page} dari {totalPages}</p>
        <PageSizeSelect value={pageSize} onChange={onPageSize} />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(page - 1)} disabled={page === 1} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <button onClick={() => onPage(page + 1)} disabled={page === totalPages} className="btn-ghost p-2 disabled:opacity-30"><ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}
