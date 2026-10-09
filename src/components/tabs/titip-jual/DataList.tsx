'use client';

import { useRef, useState } from 'react';
import { Pencil, Trash2, Loader2, Search, Check, Upload, ChevronRight } from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import Tooltip from '@/components/Tooltip';
import ViewToggle from '@/components/ViewToggle';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useViewMode } from '@/lib/useViewMode';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { Plus } from 'lucide-react';
import Pager from './Pager';
import { exportExcel, exportPdf, type ExportCol } from './exporters';
import { HEADER_BTN_H } from './shared';

export type { ExportCol };

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onChange(); }}
      className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors"
      style={{ background: checked || indeterminate ? 'var(--accent)' : 'transparent', borderColor: checked || indeterminate ? 'var(--accent)' : 'var(--border)' }}>
      {indeterminate && !checked
        ? <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />
        : checked ? <Check size={11} color="#fff" strokeWidth={3} /> : null}
    </button>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.trim().slice(0, 2) || '?').toUpperCase();
}

// Panel detail standar: grid label/nilai 2 kolom, seperti SupplierDetail. `wide` = baris penuh.
export function DetailPanel({ fields, children }: { fields: { label: string; value: React.ReactNode; wide?: boolean }[]; children?: React.ReactNode }) {
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {fields.map((f, i) => (
          <div key={i} className={`min-w-0 ${f.wide ? 'col-span-2' : ''}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>{f.label}</p>
            <div className="text-xs font-medium break-words" style={{ color: 'var(--text-secondary)' }}>{f.value || '–'}</div>
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}

// Tombol edit + hapus standar untuk baris/kartu.
export function RowActions({ onEdit, onDelete, deleting, size = 13 }: { onEdit?: () => void; onDelete?: () => void; deleting?: boolean; size?: number }) {
  return (
    <>
      {onEdit && <Tooltip label="Edit"><button onClick={onEdit} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}><Pencil size={size} /></button></Tooltip>}
      {onDelete && (
        <Tooltip label="Hapus">
          <button onClick={onDelete} disabled={deleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
            {deleting ? <Loader2 size={size} className="animate-spin" /> : <Trash2 size={size} />}
          </button>
        </Tooltip>
      )}
    </>
  );
}

interface Props<T> {
  creds: string;
  items: T[];                          // sudah difilter (kecuali pencarian) dan diurutkan oleh pemanggil
  totalCount: number;                  // jumlah seluruh data tanpa filter (untuk keadaan kosong)
  getId: (t: T) => string;
  noun: string;                        // "penitip", "produk", …
  searchText: (t: T) => string;
  searchPlaceholder: string;
  viewKey: string;
  resetKey?: string;                   // berubah (mis. filter diganti) → kembali ke halaman 1
  addLabel?: string; onAdd?: () => void; emptyHint?: string;
  filters?: React.ReactNode;           // filter tambahan di toolbar
  headerExtra?: React.ReactNode;       // tombol tambahan di sebelah tombol Tambah
  avatar?: (t: T) => string;           // teks inisial; kalau tidak diisi tidak ada avatar
  avatarImage?: (t: T) => string | undefined; // logo/gambar; kalau ada dipakai menggantikan inisial
  renderBody: (t: T) => React.ReactNode;
  actions?: (t: T) => React.ReactNode;
  renderDetail?: (t: T) => React.ReactNode; // isi panel detail; kalau ada, muncul tombol panah "Lihat detail"
  onBulkDelete?: (ids: string[]) => Promise<void>;
  // Impor Excel (opsional): unduh template + unggah file. `onFile` menangani baca file & kirim ke server.
  importer?: { onTemplate: () => void; onFile: (file: File) => Promise<void> };
  exportCols: ExportCol<T>[]; exportTitle: string; exportFile: string;
}

// Daftar standar Titip Jual — meniru pola Supplier/Mitra: cari, export Excel/PDF, toggle
// tabel/kartu, centang + penomoran, paginasi bernomor, dan bar aksi massal.
export default function DataList<T>(p: Props<T>) {
  const toast = useToast();
  const confirm = useConfirm();
  const storeHeader = useStoreHeader(p.creds);
  const [view, setView] = useViewMode(p.viewKey);
  const [search, setSearch] = useState('');
  const [pageState, setPageState] = useState({ page: 1, key: '' });
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const resetKey = `${search}|${p.resetKey ?? ''}`;
  const page = pageState.key === resetKey ? pageState.page : 1;

  const q = search.trim().toLowerCase();
  const filtered = q ? p.items.filter(t => p.searchText(t).toLowerCase().includes(q)) : p.items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = Number.isFinite(pageSize) ? filtered.slice((safePage - 1) * pageSize, safePage * pageSize) : filtered;
  const goPage = (n: number) => setPageState({ page: Math.max(1, Math.min(n, totalPages)), key: resetKey });

  const liveIds = new Set(p.items.map(p.getId));
  const selectedIds = [...selected].filter(id => liveIds.has(id));
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageIds = paginated.map(p.getId);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const togglePage = () => setSelected(s => {
    const n = new Set(s);
    if (allPageSelected) pageIds.forEach(id => n.delete(id)); else pageIds.forEach(id => n.add(id));
    return n;
  });

  const doExcel = async (rows: T[], label: string) => {
    if (rows.length === 0) { toast.error(`Tidak ada ${p.noun} untuk diexport.`); return; }
    setExporting(true);
    try { await exportExcel(p.exportCols, rows, p.exportTitle, label, p.exportFile); toast.success(`Berhasil export ${rows.length} ${p.noun} (${label}) ke Excel.`); }
    catch { toast.error('Gagal membuat file Excel.'); }
    finally { setExporting(false); }
  };
  const doPdf = async (rows: T[], label: string) => {
    if (rows.length === 0) { toast.error(`Tidak ada ${p.noun} untuk diexport.`); return; }
    setExportingPdf(true);
    try { await exportPdf(p.exportCols, rows, p.exportTitle, label, p.exportFile, storeHeader); toast.success(`Berhasil export ${rows.length} ${p.noun} (${label}) ke PDF.`); }
    catch { toast.error('Gagal membuat file PDF.'); }
    finally { setExportingPdf(false); }
  };
  const selectedItems = p.items.filter(t => selected.has(p.getId(t)));

  const bulkDelete = async () => {
    if (!p.onBulkDelete || selectedIds.length === 0) return;
    if (!await confirm({ message: `Hapus ${selectedIds.length} ${p.noun} yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    await p.onBulkDelete(selectedIds);
    setSelected(new Set());
    setBulkDeleting(false);
  };

  const btn = { height: HEADER_BTN_H, width: HEADER_BTN_H };

  const handleFile = async (f: File) => {
    setImporting(true);
    try { await p.importer!.onFile(f); } finally { setImporting(false); }
  };
  const importButtons = p.importer && (
    <>
      <Tooltip label="Unduh Template">
        <button onClick={p.importer.onTemplate} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={btn}>
          <ExcelIcon size={14} />
        </button>
      </Tooltip>
      <Tooltip label={importing ? 'Mengimpor…' : 'Upload Excel'}>
        <button onClick={() => importRef.current?.click()} disabled={importing} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={btn}>
          {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        </button>
      </Tooltip>
      <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
    </>
  );

  if (p.totalCount === 0) {
    return (
      <div className="space-y-4">
        {p.importer && <div className="flex items-center justify-end gap-2">{importButtons}</div>}
        <EmptyAddCard label={p.addLabel ?? p.emptyHint ?? `Belum ada ${p.noun}`} onClick={p.onAdd} hint={p.addLabel ? p.emptyHint : undefined} />
      </div>
    );
  }

  const avatarBox = (t: T, big?: boolean) => p.avatar && (
    <div className={`${big ? 'w-12 h-12 rounded-2xl text-sm' : 'w-10 h-10 rounded-xl text-xs'} flex-shrink-0 flex items-center justify-center font-bold overflow-hidden`}
      style={{ background: p.avatarImage?.(t) ? 'var(--surface)' : 'var(--accent-bg)', color: 'var(--accent)' }}>
      {p.avatarImage?.(t)
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.avatarImage(t)} alt="" className="w-full h-full" style={{ objectFit: 'contain' }} />
        : p.avatar!(t)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-row items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} className="input text-sm w-full"
            style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder={p.searchPlaceholder} />
        </div>
        <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
          {p.filters}
          {importButtons}
          <Tooltip label="Export Excel">
            <button onClick={() => doExcel(filtered, 'sesuai filter')} disabled={exporting} aria-label="Export Excel" className="btn-ghost p-0 flex items-center justify-center" style={btn}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
            </button>
          </Tooltip>
          <Tooltip label="Export PDF">
            <button onClick={() => doPdf(filtered, 'sesuai filter')} disabled={exportingPdf} aria-label="Export PDF" className="btn-ghost p-0 flex items-center justify-center" style={btn}>
              {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
            </button>
          </Tooltip>
          <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
          {p.headerExtra}
          {p.onAdd && (
            <button onClick={p.onAdd} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
              <Plus size={13} /> <span className="hidden sm:inline">{p.addLabel}</span>
            </button>
          )}
        </div>
      </div>

      {paginated.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
          <Checkbox checked={allPageSelected} indeterminate={pageIds.some(id => selected.has(id)) && !allPageSelected} onChange={togglePage} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            {selectedIds.length > 0 ? `${selectedIds.length} dipilih` : `${paginated.length} ${p.noun} di halaman ini`}
          </span>
        </div>
      )}

      {paginated.length === 0 ? (
        <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada {p.noun} yang cocok.</p></div>
      ) : view === 'table' ? (
        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
          {paginated.map((t, idx) => {
            const id = p.getId(t);
            const isSel = selected.has(id);
            const rowNum = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
            return (
              <div key={id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSel ? 'rgba(212,105,30,0.05)' : undefined, transition: 'background 0.1s' }}>
                <div className="flex items-center gap-2 px-4 py-3.5">
                  <Checkbox checked={isSel} onChange={() => toggle(id)} />
                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={{ color: 'var(--text-muted)' }}>{rowNum}</span>
                  {avatarBox(t)}
                  <div className="flex-1 min-w-0">{p.renderBody(t)}</div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {p.actions?.(t)}
                    {p.renderDetail && (
                      <Tooltip label="Lihat detail">
                        <button onClick={() => setExpandedId(expandedId === id ? null : id)} className="btn-ghost p-2">
                          <ChevronRight size={13} style={{ transform: expandedId === id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
                {expandedId === id && p.renderDetail?.(t)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginated.map((t, idx) => {
            const id = p.getId(t);
            const isSel = selected.has(id);
            const rowNum = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0) + idx + 1;
            return (
              <div key={id} className="card overflow-hidden relative flex flex-col" style={{ outline: isSel ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                <div className="flex items-center gap-2 px-4 pt-3">
                  <Checkbox checked={isSel} onChange={() => toggle(id)} />
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--text-muted)' }}>#{rowNum}</span>
                </div>
                <div className="flex items-start gap-3 px-4 pt-2 pb-3 flex-1">
                  {avatarBox(t, true)}
                  <div className="flex-1 min-w-0">{p.renderBody(t)}</div>
                </div>
                {(p.actions || p.renderDetail) && (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                    {p.renderDetail ? (
                      <button onClick={() => setExpandedId(expandedId === id ? null : id)} className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                        Detail <ChevronRight size={12} style={{ transform: expandedId === id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                      </button>
                    ) : <span />}
                    <div className="flex items-center gap-1 flex-shrink-0">{p.actions?.(t)}</div>
                  </div>
                )}
                {expandedId === id && p.renderDetail?.(t)}
              </div>
            );
          })}
        </div>
      )}

      <Pager total={filtered.length} noun={p.noun} page={safePage} totalPages={totalPages} pageSize={pageSize}
        onPage={goPage} onPageSize={n => { setPageSize(n); goPage(1); }} />

      {selectedIds.length > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedIds.length} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => doExcel(selectedItems, 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl flex-shrink-0 whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />} Export
            </button>
            <button onClick={() => doPdf(selectedItems, 'terpilih')} disabled={exportingPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl flex-shrink-0 whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />} PDF
            </button>
            {p.onBulkDelete && (
              <button onClick={bulkDelete} disabled={bulkDeleting}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl flex-shrink-0 whitespace-nowrap" style={{ background: 'var(--danger)', color: '#fff' }}>
                {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}
