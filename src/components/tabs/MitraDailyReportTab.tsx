'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Store, Search, Loader2, ChevronLeft, ChevronRight, RefreshCw, Check, X, Eye,
  Send, ShoppingBag, CalendarCheck, CalendarDays, Scale,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { describePeriod, formatReportDay, type DailyProductRow, type MitraDailyReportSection } from '@/lib/mitra-daily-report';
import { type PeriodKey, periodRange, PERIOD_OPTIONS } from '@/lib/period';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import FilterSelect from '@/components/FilterSelect';
import PageSizeSelect from '@/components/PageSizeSelect';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';
import { DateInput } from '@/components/DateTimeInput';

import { HEADER_BTN_H } from '@/lib/ui-constants';
import { formatRp } from '@/lib/format';
import Modal from '@/components/Modal';

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
const periodText = (from: string, to: string) => describePeriod(from, to).text;
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

const pctText = (n: number | null) => (n === null ? '-' : `${n.toLocaleString('id-ID')}%`);

function ProductTable({ rows, totalLabel = 'Total' }: { rows: DailyProductRow[]; totalLabel?: string }) {
  const sum = (k: 'kirim' | 'nilaiKirim' | 'jual' | 'nilaiJual' | 'retur' | 'reject' | 'selisih' | 'stokAwal' | 'stokAkhir') => rows.reduce((t, r) => t + r[k], 0);
  const th = 'px-2.5 py-2 text-[11px] font-bold uppercase text-right whitespace-nowrap';
  const td = 'px-2.5 py-2 text-xs tabular text-right whitespace-nowrap';
  const dash = (n: number) => (n ? n : '-');
  const dashRp = (n: number) => (n ? formatRp(n) : '-');
  return (
    <div className="card overflow-x-auto" style={{ borderColor: 'var(--border-2)' }}>
      <table className="w-full" style={{ minWidth: 820 }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase text-left">No</th>
            <th className="px-2.5 py-2 text-[11px] font-bold uppercase text-left">Produk</th>
            <th className={th}>Stok Awal</th><th className={th}>Harga Satuan</th><th className={th}>Kirim</th><th className={th}>Nilai Kirim</th>
            <th className={th}>Terjual</th><th className={th}>Nilai Terjual</th><th className={th}>Retur</th><th className={th}>Reject</th>
            <th className={th}>Selisih</th><th className={th}>Stok Akhir</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.productId} style={{ borderTop: '1px solid var(--border-2)' }}>
              <td className="px-2.5 py-2 text-xs tabular" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
              <td className="px-2.5 py-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{r.productName}</td>
              <td className={td}>{r.stokAwal}</td><td className={td}>{dashRp(r.harga)}</td><td className={td}>{dash(r.kirim)}</td><td className={td}>{dashRp(r.nilaiKirim)}</td>
              <td className={td}>{dash(r.jual)}</td><td className={td}>{dashRp(r.nilaiJual)}</td>
              <td className={td} style={r.retur ? { color: 'var(--info, #1D4ED8)', fontWeight: 700 } : undefined}>{dash(r.retur)}</td>
              <td className={td} style={r.reject ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{dash(r.reject)}</td>
              <td className={td} style={r.selisih < 0 ? { color: 'var(--danger)' } : undefined}>{r.selisih ? formatRp(r.selisih) : '-'}</td>
              <td className={`${td} font-bold`}>{r.stokAkhir}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
            <td className="px-2.5 py-2" /><td className="px-2.5 py-2 text-xs font-bold">{totalLabel}</td><td className={`${td} font-bold`}>{sum('stokAwal')}</td><td className="px-2.5 py-2" />
            <td className={`${td} font-bold`}>{sum('kirim')}</td><td className={`${td} font-bold`}>{formatRp(sum('nilaiKirim'))}</td>
            <td className={`${td} font-bold`}>{sum('jual')}</td><td className={`${td} font-bold`}>{formatRp(sum('nilaiJual'))}</td>
            <td className={`${td} font-bold`}>{sum('retur')}</td><td className={`${td} font-bold`}>{sum('reject')}</td>
            <td className={`${td} font-bold`}>{formatRp(sum('selisih'))}</td><td className={`${td} font-bold`}>{sum('stokAkhir')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DayTables({ section }: { section: ReportSection }) {
  if (section.days.length === 0) {
    return <p className="text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>Tidak ada kirim maupun rekap pada periode ini.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {section.days.map(day => (
        <div key={day.date}>
          <p className="text-xs font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
            {formatReportDay(day.date)} <span className="font-medium" style={{ color: 'var(--text-muted)' }}>· stok awal {day.totals.stokAwal} | akhir {day.totals.stokAkhir} pcs</span>
          </p>
          <ProductTable rows={day.rows} totalLabel="Subtotal" />
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
  const [summaryOpen, setSummaryOpen] = useState(true);        // ringkasan semua mitra (bawah daftar)
  const [previewSummaryOpen, setPreviewSummaryOpen] = useState(true); // ringkasan di modal preview

  // Generasi request — respons periode lama yang datang belakangan tidak boleh menimpa periode baru.
  const loadIdRef = useRef(0);
  const load = async () => {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    setError('');
    // Batas waktu: tanpa ini, permintaan yang menggantung membuat halaman "memuat" tanpa akhir.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(`/api/consignment/daily-report?from=${from}&to=${to}`, { headers, signal: ctrl.signal });
      if (myLoadId !== loadIdRef.current) return;
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'Gagal memuat laporan.');
      }
      const d = await r.json() as { sections: ReportSection[] };
      setSections(d.sections);
    } catch (e) {
      const msg = e instanceof DOMException && e.name === 'AbortError'
        ? 'Server tidak merespons dalam 25 detik. Coba lagi.'
        : e instanceof Error ? e.message : 'Gagal memuat laporan.';
      if (myLoadId === loadIdRef.current) setError(msg);
    } finally {
      clearTimeout(timer);
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

  const sum = (k: 'kirim' | 'nilaiKirim' | 'jual' | 'nilaiJual' | 'retur' | 'reject' | 'selisih') => filtered.reduce((t, s) => t + s.totals[k], 0);
  const rowOffset = Number.isFinite(pageSize) ? (safePage - 1) * pageSize : 0;
  const activeCount = filtered.filter(hasActivity).length;
  const previewSection = previewId ? sections.find(s => s.locationId === previewId) ?? null : null;

  const exportExcel = async (rows: ReportSection[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada mitra untuk diexport.'); return; }
    setExportingExcel(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
      const border = { top: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }, left: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }, right: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } } };

      // numCols = kolom angka (rata kanan); rpCols ⊂ numCols = kolom rupiah (format "Rp"#,##0).
      const addSheet = (name: string, title: string, headersRow: string[], widths: number[], data: (string | number)[][], numCols: number[], rpCols: number[]) => {
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
        head.eachCell(cell => { cell.fill = fill('FFE8821A'); cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
        ws.views = [{ state: 'frozen', ySplit: 3 }];
        data.forEach((vals, idx) => {
          const row = ws.getRow(4 + idx);
          vals.forEach((v, i) => {
            const c = row.getCell(i + 1);
            c.value = v;
            if (numCols.includes(i)) c.alignment = { horizontal: 'right' };
            if (rpCols.includes(i)) c.numFmt = '"Rp"#,##0';
          });
          row.eachCell(cell => { cell.fill = fill(idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF'); cell.border = border; });
        });
      };

      addSheet('Ringkasan', 'LAPORAN HARIAN MITRA — RINGKASAN',
        ['No', 'Mitra', 'Kode', 'Status', 'Hari Aktif', 'Kirim (pcs)', 'Nilai Kirim', 'Terjual (pcs)', 'Nilai Terjual', 'Retur', 'Reject', 'Selisih (Kirim - Terjual)', '% Terealisasi', 'Stok Awal Periode', 'Stok Akhir Periode', 'Stok Saat Ini (pcs)', 'Nilai Stok Saat Ini'],
        [6, 28, 10, 11, 10, 11, 16, 11, 16, 9, 9, 20, 13, 12, 12, 13, 17],
        rows.map((s, i) => [i + 1, s.locationName, s.code, s.isActive ? 'Aktif' : 'Nonaktif', s.days.length, s.totals.kirim, s.totals.nilaiKirim, s.totals.jual, s.totals.nilaiJual, s.totals.retur, s.totals.reject, s.totals.selisih, s.realisasiPct === null ? '-' : `${s.realisasiPct}%`, s.stokAwalPeriode, s.stokAkhirPeriode, s.currentStock, s.currentStockValue]),
        [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], [6, 8, 11, 16]);

      const productCols = ['No', 'Mitra', 'Produk', 'Stok Awal', 'Harga Satuan', 'Kirim (pcs)', 'Nilai Kirim', 'Terjual (pcs)', 'Nilai Terjual', 'Retur', 'Reject', 'Selisih (Kirim - Terjual)', 'Stok Akhir'];
      const productWidths = [6, 26, 30, 11, 15, 11, 16, 11, 16, 9, 9, 20, 11];
      const productNum = [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      const productRp = [4, 6, 8, 11];
      const productVals = (no: number, mitra: string, r: DailyProductRow) => [no, mitra, r.productName, r.stokAwal, r.harga, r.kirim, r.nilaiKirim, r.jual, r.nilaiJual, r.retur, r.reject, r.selisih, r.stokAkhir];

      const perProduct: (string | number)[][] = [];
      for (const s of rows) s.products.forEach((r, i) => perProduct.push(productVals(i + 1, s.locationName, r)));
      addSheet('Produk per Mitra', 'LAPORAN HARIAN MITRA — PRODUK YANG DIKIRIM & DIREKAP SELAMA PERIODE',
        productCols, productWidths, perProduct, productNum, productRp);

      const detail: (string | number)[][] = [];
      for (const s of rows) {
        for (const day of s.days) {
          day.rows.forEach((r, i) => detail.push([formatReportDay(day.date), ...productVals(i + 1, s.locationName, r)]));
        }
      }
      addSheet('Rincian Harian', 'LAPORAN HARIAN MITRA — RINCIAN PER HARI & PRODUK',
        ['Tanggal', ...productCols], [28, ...productWidths], detail, productNum.map(n => n + 1), productRp.map(n => n + 1));

      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `laporan-harian-mitra-${from}${to !== from ? `_${to}` : ''}.xlsx`);
      toast.success(`Berhasil export ${rows.length} mitra ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally { setExportingExcel(false); }
  };

  const exportPdf = async (rows: ReportSection[], label: string, summaryOnly = false) => {
    if (rows.length === 0) { toast.error('Tidak ada mitra untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const [{ pdf }, { default: MitraDailyReportPDF }] = await Promise.all([import('@react-pdf/renderer'), import('@/lib/pdf/MitraDailyReportPDF')]);
      const blob = await pdf(
        <MitraDailyReportPDF store={storeHeader} data={{ from, to, generatedAt: nowText(), sections: rows, summaryOnly }} />
      ).toBlob();
      const who = rows.length === 1 ? rows[0].locationName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'mitra';
      downloadBlob(blob, `laporan-harian-${who}${summaryOnly ? '-ringkasan' : ''}-${from}${to !== from ? `_${to}` : ''}.pdf`);
      toast.success(`Berhasil export ${summaryOnly ? 'ringkasan ' : ''}${rows.length} mitra (${label}) ke PDF.`);
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
    <div className="grid grid-cols-5 gap-2 text-center flex-shrink-0" style={{ minWidth: 290 }}>
      {([['Kirim', s.totals.kirim], ['Jual', s.totals.jual], ['Retur', s.totals.retur], ['Reject', s.totals.reject], ['Stok', s.currentStock]] as const).map(([label, val]) => (
        <div key={label}>
          <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{label}</p>
          <p className="text-sm font-bold tabular" style={{ color: label === 'Stok' ? 'var(--accent)' : 'var(--text-primary)' }}>{val}</p>
        </div>
      ))}
      <p className="col-span-5 text-[11px] tabular text-left mt-0.5" style={{ color: 'var(--text-muted)' }}>
        Kirim {formatRp(s.totals.nilaiKirim)} · Terjual {formatRp(s.totals.nilaiJual)} · Selisih <b style={{ color: s.totals.selisih < 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>{formatRp(s.totals.selisih)}</b>
      </p>
    </div>
  );
  const badges = (s: ReportSection) => (
    <>
      {s.code && (
        <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded"
          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{s.code}</span>
      )}
      {!s.isActive && <span className="badge badge-gray" style={{ fontSize: 10, padding: '1px 6px' }}>Nonaktif</span>}
      {!hasActivity(s) && <span className="badge badge-gray" style={{ fontSize: 10, padding: '1px 6px' }}>Tanpa aktivitas</span>}
    </>
  );
  const previewButton = (s: ReportSection) => (
    <Tooltip label="Lihat laporan">
      <button aria-label="Lihat laporan" onClick={() => setPreviewId(s.locationId)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}><Eye size={14} /></button>
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
          { icon: <Send size={16} />, label: `Total Kirim · ${sum('kirim')} pcs`, val: formatRp(sum('nilaiKirim')), color: 'var(--accent)', bg: 'var(--accent-bg)' },
          { icon: <ShoppingBag size={16} />, label: `Total Terjual · ${sum('jual')} pcs`, val: formatRp(sum('nilaiJual')), color: 'var(--success)', bg: 'var(--success-bg)' },
          { icon: <Scale size={16} />, label: `Selisih (Kirim - Terjual) · ${pctText(sum('nilaiKirim') > 0 ? Math.round((sum('nilaiJual') / sum('nilaiKirim')) * 1000) / 10 : null)} terealisasi`, val: formatRp(sum('selisih')), color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
          { icon: <CalendarCheck size={16} />, label: 'Mitra Ada Aktivitas', val: `${activeCount} / ${filtered.length}`, color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
        ].map((c, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: c.bg, color: c.color }}>{c.icon}</div>
            <div className="min-w-0">
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
            <DateInput value={customFrom} onChange={setCustomFrom} height={36} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <DateInput value={customTo} onChange={setCustomTo} height={36} />
          </div>
        )}
      </div>
      <div className="card px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}><CalendarDays size={13} /> Periode laporan</span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Dari <b style={{ color: 'var(--text-primary)' }}>{describePeriod(from, to).fromLong}</b></span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Sampai <b style={{ color: 'var(--text-primary)' }}>{describePeriod(from, to).toLong}</b></span>
        <span className="badge badge-gray text-[11px]">{describePeriod(from, to).days} hari</span>
      </div>

      {/* Header: filter + search + aksi */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="w-full sm:w-[170px] flex-shrink-0">
          <FilterSelect searchable={false} value={statusFilter} onChange={v => { setStatusFilter(v); resetPage(); }} height={HEADER_BTN_H} options={statusOptions} />
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
            <Tooltip label="Export PDF Ringkasan saja">
              <button onClick={() => exportPdf(filtered, 'sesuai filter', true)} disabled={exportingPdf} aria-label="Export PDF Ringkasan"
                className="btn-ghost px-2.5 text-[11px] font-bold flex items-center justify-center gap-1.5" style={{ height: HEADER_BTN_H }}>
                <PdfIcon size={14} /> <span className="hidden md:inline">Ringkasan</span>
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
            <div className="card overflow-x-auto" style={{ borderColor: 'var(--border-2)' }}>
              <table className="w-full" style={{ minWidth: 1080 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    <th className="px-2.5 py-2 text-[11px] font-bold uppercase text-left">No</th>
                    <th className="px-1 py-2" style={{ width: 28 }} />
                    <th className="px-2.5 py-2 text-[11px] font-bold uppercase text-left">Mitra</th>
                    {['Stok Awal', 'Kirim', 'Nilai Kirim', 'Terjual', 'Nilai Terjual', 'Retur', 'Reject', 'Selisih', 'Stok Akhir'].map(h => (
                      <th key={h} className="px-2.5 py-2 text-[11px] font-bold uppercase text-right whitespace-nowrap"
                        style={h === 'Retur' ? { color: '#1D4ED8' } : h === 'Reject' ? { color: 'var(--danger)' } : undefined}>{h}</th>
                    ))}
                    <th className="px-2.5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((s, idx) => {
                    const isSelected = selected.has(s.locationId);
                    const num = rowOffset + idx + 1;
                    const td = 'px-2.5 py-2.5 text-xs tabular text-right whitespace-nowrap';
                    const dash = (n: number) => (n ? n : '-');
                    return (
                      <tr key={s.locationId} style={{ borderTop: '1px solid var(--border-2)', background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, opacity: s.isActive ? 1 : 0.75 }}>
                        <td className="px-2.5 py-2.5 text-xs font-bold tabular" style={{ color: 'var(--text-muted)' }}>{num}</td>
                        <td className="px-1 py-2.5"><Checkbox checked={isSelected} onChange={() => toggleSelect(s.locationId)} /></td>
                        <td className="px-2.5 py-2.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.locationName}</p>
                            {badges(s)}
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {[s.contactName, s.contactPhone].filter(Boolean).join(' · ') || '—'} · {s.days.length} hari ada aktivitas
                          </p>
                        </td>
                        <td className={td}>{s.stokAwalPeriode}</td>
                        <td className={td}>{dash(s.totals.kirim)}</td>
                        <td className={td}>{s.totals.nilaiKirim ? formatRp(s.totals.nilaiKirim) : '-'}</td>
                        <td className={td}>{dash(s.totals.jual)}</td>
                        <td className={td}>{s.totals.nilaiJual ? formatRp(s.totals.nilaiJual) : '-'}</td>
                        <td className={td} style={s.totals.retur ? { color: '#1D4ED8', fontWeight: 700 } : undefined}>{dash(s.totals.retur)}</td>
                        <td className={td} style={s.totals.reject ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{dash(s.totals.reject)}</td>
                        <td className={td} style={s.totals.selisih < 0 ? { color: 'var(--danger)' } : undefined}>{s.totals.selisih ? formatRp(s.totals.selisih) : '-'}</td>
                        <td className={`${td} font-bold`}>{s.stokAkhirPeriode}</td>
                        <td className="px-2.5 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            {previewButton(s)}
                            <Tooltip label="PDF mitra ini">
                              <button aria-label="PDF mitra ini" onClick={() => exportPdf([s], s.locationName)} disabled={exportingPdf} className="btn-ghost p-2"><PdfIcon size={14} /></button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                    <td className="px-2.5 py-2.5" /><td className="px-1 py-2.5" />
                    <td className="px-2.5 py-2.5 text-xs font-bold">Total ({filtered.length} mitra)</td>
                    {[
                      filtered.reduce((a, s) => a + s.stokAwalPeriode, 0), sum('kirim'), formatRp(sum('nilaiKirim')), sum('jual'), formatRp(sum('nilaiJual')),
                      sum('retur'), sum('reject'), formatRp(sum('selisih')), filtered.reduce((a, s) => a + s.stokAkhirPeriode, 0),
                    ].map((v, i) => <td key={i} className="px-2.5 py-2.5 text-xs tabular text-right font-bold whitespace-nowrap">{v}</td>)}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map((s, idx) => {
                const isSelected = selected.has(s.locationId);
                const num = rowOffset + idx + 1;
                return (
                  <div key={s.locationId} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2, opacity: s.isActive ? 1 : 0.75 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(s.locationId)} />
                    </div>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        <Store size={20} />
                      </div>
                      <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{num}. {s.locationName}</p>
                      <div className="flex items-center justify-center gap-1 flex-wrap">{badges(s)}</div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{[s.contactName, s.contactPhone].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    <div className="px-4 pb-3 flex justify-center">{metrics(s)}</div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.days.length} hari aktivitas</span>
                      <div className="flex items-center gap-1">
                        {previewButton(s)}
                        <Tooltip label="PDF mitra ini">
                          <button aria-label="PDF mitra ini" onClick={() => exportPdf([s], s.locationName)} disabled={exportingPdf} className="btn-ghost p-1.5"><PdfIcon size={14} /></button>
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
                    <button aria-label="Halaman sebelumnya" onClick={() => goPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft size={14} /></button>
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
                    <button aria-label="Halaman berikutnya" onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30"><ChevronRight size={14} /></button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Ringkasan semua mitra — bagian terpisah di paling bawah (sama dengan halaman terakhir PDF) */}
      {!error && filtered.length > 1 && (
        <div>
          <div className="flex items-stretch gap-2">
          <button type="button" onClick={() => setSummaryOpen(o => !o)} aria-expanded={summaryOpen}
            className="flex-1 min-w-0 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-left" style={{ background: 'var(--text-primary)', color: '#fff' }}>
            <span className="text-xs font-bold tracking-wide flex items-center gap-2">
              <ChevronRight size={14} style={{ transform: summaryOpen ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
              RINGKASAN SEMUA MITRA
            </span>
            <span className="text-[11px] opacity-80">{periodText(from, to)} · {summaryOpen ? 'klik untuk menutup' : 'klik untuk membuka'}</span>
          </button>
          <Tooltip label="Download PDF ringkasan saja">
            <button onClick={() => exportPdf(filtered, 'sesuai filter', true)} disabled={exportingPdf} className="btn-ghost px-3 flex items-center gap-1.5 text-xs font-bold flex-shrink-0">
              {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />} <span className="hidden sm:inline">PDF Ringkasan</span>
            </button>
          </Tooltip>
          </div>
          {summaryOpen && <div className="card overflow-x-auto mt-3" style={{ borderColor: 'var(--border-2)' }}>
            <table className="w-full" style={{ minWidth: 560 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  {['No', 'Mitra', 'Total Kirim', 'Total Terjual', 'Selisih', '% Real.', 'Stok'].map((h, i) => (
                    <th key={h} className={`px-2.5 py-2 text-[11px] font-bold uppercase ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={s.locationId} style={{ borderTop: '1px solid var(--border-2)' }}>
                    <td className="px-2.5 py-2 text-xs tabular" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="px-2.5 py-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{s.locationName}</td>
                    <td className="px-2.5 py-2 text-xs tabular text-right">{s.totals.nilaiKirim ? formatRp(s.totals.nilaiKirim) : '-'}</td>
                    <td className="px-2.5 py-2 text-xs tabular text-right">{s.totals.nilaiJual ? formatRp(s.totals.nilaiJual) : '-'}</td>
                    <td className="px-2.5 py-2 text-xs tabular text-right" style={s.totals.selisih < 0 ? { color: 'var(--danger)' } : undefined}>{s.totals.selisih ? formatRp(s.totals.selisih) : '-'}</td>
                    <td className="px-2.5 py-2 text-xs tabular text-right">{pctText(s.realisasiPct)}</td>
                    <td className="px-2.5 py-2 text-xs tabular text-right font-bold">{s.currentStock}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                  <td className="px-2.5 py-2" /><td className="px-2.5 py-2 text-xs font-bold">Total</td>
                  <td className="px-2.5 py-2 text-xs tabular text-right font-bold">{formatRp(sum('nilaiKirim'))}</td>
                  <td className="px-2.5 py-2 text-xs tabular text-right font-bold">{formatRp(sum('nilaiJual'))}</td>
                  <td className="px-2.5 py-2 text-xs tabular text-right font-bold">{formatRp(sum('selisih'))}</td>
                  <td className="px-2.5 py-2 text-xs tabular text-right font-bold">{pctText(sum('nilaiKirim') > 0 ? Math.round((sum('nilaiJual') / sum('nilaiKirim')) * 1000) / 10 : null)}</td>
                  <td className="px-2.5 py-2 text-xs tabular text-right font-bold">{filtered.reduce((a, s) => a + s.currentStock, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>}
        </div>
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
            <button onClick={() => exportPdf(sections.filter(s => selected.has(s.locationId)), 'terpilih', true)} disabled={exportingPdf}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              <PdfIcon size={13} /> PDF Ringkasan
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">Batal</button>
          </div>
        </div>
      )}

      {/* Preview laporan satu mitra */}
      {previewSection && (
        <Modal onClose={() => setPreviewId(null)} className="modal-lg" style={{ maxWidth: 1120 }}>
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
              <Tooltip label="PDF ringkasan saja">
                <button onClick={() => exportPdf([previewSection], previewSection.locationName, true)} disabled={exportingPdf} className="h-8 px-2 rounded-lg flex items-center gap-1 text-[11px] font-bold flex-shrink-0" style={{ background: 'var(--surface-2)' }}>
                  <PdfIcon size={13} /> Ringkasan
                </button>
              </Tooltip>
              <Tooltip label="Download PDF">
                <button onClick={() => exportPdf([previewSection], previewSection.locationName)} disabled={exportingPdf} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)' }}>
                  {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                </button>
              </Tooltip>
              <Tooltip label="Tutup"><button onClick={() => setPreviewId(null)} className="modal-close" aria-label="Tutup"><X size={14} /></button></Tooltip>
            </div>
          </div>
          <div className="modal-body">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
              <div className="p-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Lokasi / Mitra</p>
                <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{previewSection.locationName}{previewSection.code ? ` · ${previewSection.code}` : ''}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{previewSection.days.length} hari ada aktivitas · {previewSection.products.length} produk</p>
              </div>
              <div className="p-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Periode Laporan</p>
                <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>Dari: {describePeriod(from, to).fromLong}</p>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Sampai: {describePeriod(from, to).toLong}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Lama periode: {describePeriod(from, to).days} hari</p>
              </div>
            </div>

            <p className="text-xs font-bold mb-2" style={{ color: 'var(--accent)' }}>Rincian per hari</p>
            <DayTables section={previewSection} />

            {/* Ringkasan — bagian terpisah di paling bawah (urutan sama dengan PDF) */}
            <button type="button" onClick={() => setPreviewSummaryOpen(o => !o)} aria-expanded={previewSummaryOpen}
              className="mt-6 w-full rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-left" style={{ background: 'var(--text-primary)', color: '#fff' }}>
              <span className="text-xs font-bold tracking-wide flex items-center gap-2">
                <ChevronRight size={14} style={{ transform: previewSummaryOpen ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                RINGKASAN · {previewSection.locationName.toUpperCase()}
              </span>
              <span className="text-[11px] opacity-80">{periodText(from, to)}</span>
            </button>
            {previewSummaryOpen && <>
            {previewSection.days.length > 1 && (
              <div className="mt-3">
                <p className="text-xs font-bold mb-1.5" style={{ color: 'var(--accent)' }}>Produk selama periode ({previewSection.products.length} produk)</p>
                <ProductTable rows={previewSection.products} totalLabel="Total periode" />
              </div>
            )}
            <div className="mt-4 ml-auto rounded-xl p-4" style={{ background: 'var(--accent-bg)', maxWidth: 440 }}>
              {([
                ['Total Kirim', `${previewSection.totals.kirim} pcs · ${formatRp(previewSection.totals.nilaiKirim)}`, undefined],
                ['Total Terjual', `${previewSection.totals.jual} pcs · ${formatRp(previewSection.totals.nilaiJual)}`, 'var(--success)'],
                ['Total Retur', `${previewSection.totals.retur} pcs · ${formatRp(previewSection.products.reduce((a, r) => a + r.retur * r.harga, 0))}`, '#1D4ED8'],
                ['Total Reject', `${previewSection.totals.reject} pcs · ${formatRp(previewSection.products.reduce((a, r) => a + r.reject * r.harga, 0))}`, 'var(--danger)'],
                ['% Terealisasi (terjual / kirim)', pctText(previewSection.realisasiPct), undefined],
                ['Stok Awal Periode', `${previewSection.stokAwalPeriode} pcs`, undefined],
                ['Stok Akhir Periode', `${previewSection.stokAkhirPeriode} pcs`, undefined],
                ['Stok Saat Ini', `${previewSection.currentStock} pcs · ${formatRp(previewSection.currentStockValue)}`, undefined],
              ] as const).map(([label, val, color]) => (
                <div key={label} className="flex justify-between gap-3 py-0.5 text-xs">
                  <span style={{ color: color ?? 'var(--text-muted)' }}>{label}</span>
                  <span className="font-bold tabular" style={{ color: color ?? 'var(--text-primary)' }}>{val}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 mt-2 pt-2 items-baseline" style={{ borderTop: '1px solid var(--border-2)' }}>
                <span className="text-sm font-bold">Selisih (Kirim - Terjual)</span>
                <span className="text-lg font-extrabold tabular" style={{ color: previewSection.totals.selisih < 0 ? 'var(--danger)' : 'var(--accent)' }}>{formatRp(previewSection.totals.selisih)}</span>
              </div>
            </div>
            </>}
            <p className="text-[11px] mt-4" style={{ color: 'var(--text-muted)' }}>
              Stok akhir dihitung dari stok titip saat ini dikurangi/ditambah kirim & rekap sesudah hari tersebut.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
