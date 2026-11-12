'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';

interface BulkBarProps {
  /** Jumlah baris terpilih. */
  count: number;
  onExportExcel: () => void;
  onExportPdf: () => void;
  exporting: boolean;
  exportingPdf: boolean;
  onDelete: () => void;
  deleting: boolean;
  onClear: () => void;
}

/** Bilah aksi massal melayang (Export / PDF / Hapus / Batal) untuk daftar dengan checkbox. */
export default function BulkBar({
  count, onExportExcel, onExportPdf, exporting, exportingPdf, onDelete, deleting, onClear,
}: BulkBarProps) {
  const chip = 'flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap';
  return (
    <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
      <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
        style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
        <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{count} dipilih</span>
        <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
        <button onClick={onExportExcel} disabled={exporting} className={chip}
          style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />}
          Export
        </button>
        <button onClick={onExportPdf} disabled={exportingPdf} className={chip}
          style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
          {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
          PDF
        </button>
        <button onClick={onDelete} disabled={deleting} className={chip}
          style={{ background: 'var(--danger)', color: '#fff' }}>
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Hapus
        </button>
        <button onClick={onClear} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
          Batal
        </button>
      </div>
    </div>
  );
}
