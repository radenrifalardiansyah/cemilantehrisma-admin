'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Store, Search, Loader2, ChevronLeft, ChevronRight, RefreshCw, Check, X, Eye,
  Send, ShoppingBag, CalendarCheck, PackageCheck,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import MitraDailyReportPDF from '@/lib/pdf/MitraDailyReportPDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { formatReportDay, type MitraDailyReportSection } from '@/lib/mitra-daily-report';
import { type PeriodKey, periodRange, PERIOD_OPTIONS } from '@/lib/period';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import FilterSelect from '@/components/FilterSelect';
import PageSizeSelect from '@/components/PageSizeSelect';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';

const HEADER_BTN_H = 34;

interface ReportSection extends MitraDailyReportSection {
  code: string; contactName: string; contactPhone: string; isActive: boolean;
}

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(); }}
      className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors"
      style={{
        background:  checked || indeterminate ? 'var(--accent)' : 'transparent',
        borderColor: checked || indeterminate ? 'var(--accent)' : 'var(--border)',
      }}
    >
      {indeterminate && !checked
        ? <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />
        : checked ? <Check size={11} color="#fff" strokeWidth={3} /> : null}
    </button>
  );
}

const hasActivity = (s: ReportSection) => s.days.length > 0;
const fmtShort = (iso: string) =>
  new Date(`${iso}T12:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
const periodText = (from: string, to: string) => (from === to ? fmtShort(from) : `${fmtShort(from)} - ${fmtShort(to)}`);
const nowText = () => new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DayTables({ section }: { section: ReportSection }) {
  if (section.days.length === 0) {
    return <p className="text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>Tidak ada kirim maupun rekap pada periode ini.</p>;
  }
  const th = 'px-3 py-2 text-[10px] font-bold uppercase text-right';
  const td = 'px-3 py-2 text-xs tabular text-right';
  return (
    <div className="flex flex-col gap-4">
      {section.days.map(day => (
        <div key={day.date}>
          <p className="text-xs font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>{formatReportDay(day.date)}</p>
          <div className="card overflow-x-auto" style={{ borderColor: 'var(--border-2)' }}>
            <table className="w-full" style={{ minWidth: 420 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-left">Produk</th>
                  <th className={th}>Kirim</th><th className={th}>Jual</th><th className={th}>Retur</th><th className={th}>Reject</th><th className={th}>Stok Akhir</th>
                </tr>
              </thead>
              <tbody>
                {day.rows.map(r => (
                  <tr key={r.productId} style={{ borderTop: '1px solid var(--border-2)' }}>
                    <td className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{r.productName}</td>
                    <td className={td}>{r.kirim || '-'}</td><td className={td}>{r.jual || '-'}</td>
                    <td className={td}>{r.retur || '-'}</td><td className={td}>{r.reject || '-'}</td>
                    <td className={`${td} font-bold`}>{r.stokAkhir}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                  <td className="px-3 py-2 text-xs font-bold">Total</td>
                  <td className={`${td} font-bold`}>{day.totals.kirim}</td><td className={`${td} font-bold`}>{day.totals.jual}</td>
                  <td className={`${td} font-bold`}>{day.totals.retur}</td><td className={`${td} font-bold`}>{day.totals.reject}</td>
                  <td className={`${td} font-bold`}>{day.totals.stokAkhir}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// Manajemen → Laporan → Laporan Harian Mitra.
export default function MitraDailyReportTab({ creds }: { creds: string }) {
  const toast = useToast();
  const storeHeader = useStoreHeader(creds);
  const headers = { 'x-admin-auth': creds };

  const [period, setPeriod] = useState<PeriodKey>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const { from, to } = periodRange(period, customFrom, customTo);

  const [sections, setSections] = useState<ReportSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('semua');
  const [onlyActivity, setOnlyActivity] = useState(false);
  const [view, setView] = useViewMode('mitra-daily-report');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Generasi request — respons periode lama yang datang belakangan tidak boleh menimpa periode baru.
  const loadIdRef = useRef(0);
  const load = async () => {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/consignment/daily-report?from=${from}&to=${to}`, { headers });
      if (myLoadId !== loadIdRef.current) return;
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'Gagal memuat laporan.');
      }
      const d = await r.json() as { sections: ReportSection[] };
      setSections(d.sections);
    } catch (e) {
      if (myLoadId === loadIdRef.current) setError(e instanceof Error ? e.message : 'Gagal memuat laporan.');
    } finally {
      if (myLoadId === loadIdRef.current) setLoading(false);
    }
  };
  useEffect(() => { load(); setSelected(new Set()); setPage(1); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  const filtered = sections.filter(s => {
    if (statusFilter === 'aktif' && !s.isActive) return false;
    if (statusFilter === 'nonaktif' && s.isActive) return false;
    if (onlyActivity && !hasActivity(s)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return s.locationName.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
      || s.contactName.toLowerCase().includes(q) || s.contactPhone.toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  // pageSize bisa Infinity (opsi "Semua") — (1 - 1) * Infinity = NaN, jadi tangani terpisah.
  const paginated = Number.isFinite(pageSize) ? filtered.slice((safePage - 1) * pageSize, safePage * pageSize) : filtered;
  const goPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageIds = paginated.map(s => s.locationId);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const togglePageAll = () => setSelected(s => {
    const n = new Set(s);
    if (allPageSelected) pageIds.forEach(id => n.delete(id)); else pageIds.forEach(id => n.add(id));
    return n;
  });

  const sum = (k: 'kirim' | 'jual' | 'retur' | 'reject') => filtered.reduce((t, s) => t + s.totals[k], 0);
  const activeCount = filtered.filter(hasActivity).length;
  const previewSection = previewId ? sections.find(s => s.locationId === previewId) ?? null : null;

  const exportExcel = async (rows: ReportSection[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada mitra untuk diexport.'); return; }
    setExportingExcel(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
      const border = { top: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }, left: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }, right: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } } };

      const addSheet = (name: string, title: string, headersRow: string[], widths: number[], data: (string | number)[][], numCols: number[]) => {
        const ws = wb.addWorksheet(name);
        ws.columns = widths.map(width => ({ width }));
        const n = headersRow.length;
        ws.mergeCells(1, 1, 1, n);
        const t = ws.getCell(1, 1);
        t.value = title;
        t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        t.fill = fill('FFC96018');
        ws.getRow(1).height = 28;
        ws.mergeCells(2, 1, 2, n);
        const s = ws.getCell(2, 1);
        s.value = `Periode ${periodText(from, to)} · ${rows.length} mitra (${label}) · Diexport ${nowText()}`;
        s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
        s.alignment = { horizontal: 'center', vertical: 'middle' };
        s.fill = fill('FFFDF2E9');
        ws.getRow(2).height = 20;
        const head = ws.getRow(3);
        headersRow.forEach((h, i) => { head.getCell(i + 1).value = h; });
        head.height = 24;
        head.eachCell(cell => { cell.fill = fill('FFE8821A'); cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; cell.alignment = { vertical: 'middle', horizontal: 'center' }; });
        ws.views = [{ state: 'frozen', ySplit: 3 }];
        data.forEach((vals, idx) => {
          const row = ws.getRow(4 + idx);
          vals.forEach((v, i) => {
            const c = row.getCell(i + 1);
            c.value = v;
            if (numCols.includes(i)) c.alignment = { horizontal: 'right' };
          });
          row.eachCell(cell => { cell.fill = fill(idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF'); cell.border = border; });
        });
      };

      addSheet('Ringkasan', 'LAPORAN HARIAN MITRA — RINGKASAN',
        ['Mitra', 'Kode', 'Status', 'Hari Aktif', 'Kirim', 'Jual', 'Retur', 'Reject', 'Stok Saat Ini'],
        [28, 10, 11, 11, 10, 10, 10, 10, 14],
        rows.map(s => [s.locationName, s.code, s.isActive ? 'Aktif' : 'Nonaktif', s.days.length, s.totals.kirim, s.totals.jual, s.totals.retur, s.totals.reject, s.currentStock]),
        [3, 4, 5, 6, 7, 8]);

      const detail: (string | number)[][] = [];
      for (const s of rows) {
        for (const day of s.days) {
          for (const r of day.rows) detail.push([s.locationName, formatReportDay(day.date), r.productName, r.kirim, r.jual, r.retur, r.reject, r.stokAkhir]);
        }
      }
      addSheet('Rincian Harian', 'LAPORAN HARIAN MITRA — RINCIAN PER HARI & PRODUK',
        ['Mitra', 'Tanggal', 'Produk', 'Kirim', 'Jual', 'Retur', 'Reject', 'Stok Akhir'],
        [26, 28, 30, 10, 10, 10, 10, 12], detail, [3, 4, 5, 6, 7]);

      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `laporan-harian-mitra-${from}${to !== from ? `_${to}` : ''}.xlsx`);
      toast.success(`Berhasil export ${rows.length} mitra ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally { setExportingExcel(false); }
  };

  const exportPdf = async (rows: ReportSection[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada mitra untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const blob = await pdf(
        <MitraDailyReportPDF store={storeHeader} data={{ periodText: periodText(from, to), generatedAt: nowText(), sections: rows }} />
      ).toBlob();
      const who = rows.length === 1 ? rows[0].locationName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'mitra';
      downloadBlob(blob, `laporan-harian-${who}-${from}${to !== from ? `_${to}` : ''}.pdf`);
      toast.success(`Berhasil export ${rows.length} mitra (${label}) ke PDF.`);
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally { setExportingPdf(false); }
  };

  const statusOptions = [
    { value: 'semua', label: 'Semua Status' },
    { value: 'aktif', label: 'Mitra Aktif' },
    { value: 'nonaktif', label: 'Mitra Nonaktif' },
  ];

  const metrics = (s: ReportSection) => (
    <div className="grid grid-cols-5 gap-2 text-center flex-shrink-0" style={{ minWidth: 250 }}>
      {([['Kirim', s.totals.kirim], ['Jual', s.totals.jual], ['Retur', s.totals.retur], ['Reject', s.totals.reject], ['Stok', s.currentStock]] as const).map(([label, val]) => (
        <div key={label}>
          <p className="text-[9px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{label}</p>
          <p className="text-sm font-bold tabular" style={{ color: label === 'Stok' ? 'var(--accent)' : 'var(--text-primary)' }}>{val}</p>
        </div>
      ))}
    </div>
  );
  const badges = (s: ReportSection) => (
    <>
      {s.code && (
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{s.code}</span>
      )}
      {!s.isActive && <span className="badge badge-gray" style={{ fontSize: 10, padding: '1px 6px' }}>Nonaktif</span>}
      {!hasActivity(s) && <span className="badge badge-gray" style={{ fontSize: 10, padding: '1px 6px' }}>Tanpa aktivitas</span>}
    </>
  );
  const previewButton = (s: ReportSection) => (
    <Tooltip label="Lihat laporan">
      <button onClick={() => setPreviewId(s.locationId)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}><Eye size={14} /></button>
    </Tooltip>
  );

  if (loading && sections.length === 0 && !error) return <PageLoader />;

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={load} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      {/* Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: <Send size={16} />, label: 'Total Dikirim (pcs)', val: sum('kirim'), color: 'var(--accent)', bg: 'var(--accent-bg)' },
          { icon: <ShoppingBag size={16} />, label: 'Total Terjual (pcs)', val: sum('jual'), color: 'var(--success)', bg: 'var(--success-bg)' },
          { icon: <PackageCheck size={16} />, label: 'Retur + Reject (pcs)', val: sum('retur') + sum('reject'), color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
          { icon: <CalendarCheck size={16} />, label: 'Mitra Ada Aktivitas', val: `${activeCount} / ${filtered.length}`, color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
        ].map((c, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: c.bg, color: c.color }}>{c.icon}</div>
            <div>
              <p className="text-lg font-extrabold tabular leading-none" style={{ color: c.color }}>{c.val}</p>
              <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pemilih periode */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map(p => (
          <button key={p.id} onClick={() => { setPeriod(p.id); resetPage(); }}
            className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={period === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input" style={{ height: 36 }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input" style={{ height: 36 }} />
          </div>
        )}
        <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>{periodText(from, to)}</span>
      </div>

      {/* Header: filter + search + aksi */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="w-full sm:w-[170px] flex-shrink-0">
          <FilterSelect value={statusFilter} onChange={v => { setStatusFilter(v); resetPage(); }} height={HEADER_BTN_H} searchPlaceholder="Cari status…" options={statusOptions} />
        </div>
        <div className="flex flex-row items-center gap-2 sm:gap-3 sm:flex-1">
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => { setSearch(e.target.value); resetPage(); }} className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder="Cari nama mitra, kode, kontak, atau telepon…" />
          </div>
          <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
            <button onClick={() => { setOnlyActivity(v => !v); resetPage(); }}
              className="px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0"
              style={{ height: HEADER_BTN_H, background: onlyActivity ? 'linear-gradient(135deg,#E8821A,#C96018)' : 'var(--surface-2)', color: onlyActivity ? 'white' : 'var(--text-muted)' }}>
              <CalendarCheck size={14} /> <span className="hidden sm:inline">Ada Aktivitas</span>
            </button>
            <Tooltip label="Export Excel">
              <button onClick={() => exportExcel(filtered, 'sesuai filter')} disabled={exportingExcel} aria-label="Export Excel"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exportingExcel ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
              </button>
            </Tooltip>
            <Tooltip label="Export PDF">
              <button onClick={() => exportPdf(filtered, 'sesuai filter')} disabled={exportingPdf} aria-label="Export PDF"
                className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
              </button>
            </Tooltip>
            <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
          </div>
        </div>
      </div>

      {error ? (
        <div className="card py-12 text-center">
          <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
          <button onClick={load} className="btn-ghost text-xs mt-3">Coba lagi</button>
        </div>
      ) : sections.length === 0 ? (
        <div className="card py-12 text-center">
          <Store size={28} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada mitra.</p>
        </div>
      ) : (
        <>
          {paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox checked={allPageSelected} indeterminate={pageIds.some(id => selected.has(id)) && !allPageSelected} onChange={togglePageAll} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} mitra di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada mitra yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((s, idx) => {
                const isSelected = selected.has(s.locationId);
                return (
                  <div key={s.locationId} className="flex flex-wrap items-center gap-3 px-4 py-3"
                    style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, opacity: s.isActive ? 1 : 0.75 }}>
                    <Checkbox checked={isSelected} onChange={() => toggleSelect(s.locationId)} />
                    <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                      <Store size={16} />
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.locationName}</p>
                        {badges(s)}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {[s.contactName, s.contactPhone].filter(Boolean).join(' · ') || '—'} · {s.days.length} hari ada aktivitas
                      </p>
                    </div>
                    {metrics(s)}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {previewButton(s)}
                      <Tooltip label="PDF mitra ini">
                        <button onClick={() => exportPdf([s], s.locationName)} disabled={exportingPdf} className="btn-ghost p-2"><PdfIcon size={14} /></button>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(s => {
                const isSelected = selected.has(s.locationId);
                return (
                  <div key={s.locationId} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2, opacity: s.isActive ? 1 : 0.75 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(s.locationId)} />
                    </div>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        <Store size={20} />
                      </div>
                      <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{s.locationName}</p>
                      <div className="flex items-center justify-center gap-1 flex-wrap">{badges(s)}</div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{[s.contactName, s.contactPhone].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    <div className="px-4 pb-3 flex justify-center">{metrics(s)}</div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.days.length} hari aktivitas</span>
                      <div className="flex items-center gap-1">
                        {previewButton(s)}
                        <Tooltip label="PDF mitra ini">
                          <button onClick={() => exportPdf([s], s.locationName)} disabled={exportingPdf} className="btn-ghost p-1.5"><PdfIcon size={14} /></button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{filtered.length} mitra · halaman {safePage} dari {totalPages}</p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); resetPage(); }} />
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Tooltip label="Halaman sebelumnya">
                    <button onClick={() => goPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft size={14} /></button>
                  </Tooltip>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                    .reduce<(number | '…')[]>((acc, n, i, arr) => {
                      if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(n); return acc;
                    }, [])
                    .map((n, i) => n === '…'
                      ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                      : <button key={n} onClick={() => goPage(n as number)} className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                          style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>{n}</button>)}
                  <Tooltip label="Halaman berikutnya">
                    <button onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30"><ChevronRight size={14} /></button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => exportExcel(sections.filter(s => selected.has(s.locationId)), 'terpilih')} disabled={exportingExcel}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingExcel ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={13} />} Export
            </button>
            <button onClick={() => exportPdf(sections.filter(s => selected.has(s.locationId)), 'terpilih')} disabled={exportingPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />} PDF
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">Batal</button>
          </div>
        </div>
      )}

      {/* Preview laporan satu mitra */}
      {previewSection && (
        <div className="modal-overlay" onClick={() => setPreviewId(null)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Store size={17} /></div>
                <div>
                  <p className="modal-title">{previewSection.locationName}</p>
                  <p className="modal-subtitle">Laporan harian · {periodText(from, to)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Tooltip label="Export Excel">
                  <button onClick={() => exportExcel([previewSection], previewSection.locationName)} disabled={exportingExcel} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)' }}>
                    {exportingExcel ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                  </button>
                </Tooltip>
                <Tooltip label="Download PDF">
                  <button onClick={() => exportPdf([previewSection], previewSection.locationName)} disabled={exportingPdf} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)' }}>
                    {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                  </button>
                </Tooltip>
                <Tooltip label="Tutup"><button onClick={() => setPreviewId(null)} className="modal-close"><X size={14} /></button></Tooltip>
              </div>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                {([['Kirim', previewSection.totals.kirim], ['Terjual', previewSection.totals.jual], ['Retur', previewSection.totals.retur], ['Reject', previewSection.totals.reject], ['Stok Saat Ini', previewSection.currentStock]] as const).map(([label, val]) => (
                  <div key={label} className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                    <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{label}</p>
                    <p className="text-sm font-bold tabular mt-0.5" style={{ color: label === 'Stok Saat Ini' ? 'var(--accent)' : 'var(--text-primary)' }}>{val} pcs</p>
                  </div>
                ))}
              </div>
              <DayTables section={previewSection} />
              <p className="text-[11px] mt-4" style={{ color: 'var(--text-muted)' }}>
                Stok akhir dihitung dari stok titip saat ini dikurangi/ditambah kirim & rekap sesudah hari tersebut.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
