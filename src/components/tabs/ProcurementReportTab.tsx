'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, Loader2, ChevronLeft, ChevronRight, ClipboardList, Boxes, FileBarChart, TrendingUp, TrendingDown, AlertTriangle, Wallet } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import PageSizeSelect from '@/components/PageSizeSelect';
import ViewToggle from '@/components/ViewToggle';
import { useViewMode } from '@/lib/useViewMode';
import PageLoader from '@/components/PageLoader';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useToast } from '@/components/Toast';
import { type PeriodKey, PERIOD_OPTIONS, periodRange } from '@/lib/period';
import { exportSheet } from '@/components/tabs/purchase-flow-io';
import type { PoReportRow, GrReportRow, OpnameReportRow, SupplierBreakdown, summarizePo, summarizeGr, summarizeOpname } from '@/lib/procurement-report';

// Tiga laporan Operasional > Laporan dengan kerangka yang sama: Laporan PO, Laporan GR, Laporan Stok
// Opname. Data diambil per periode dari /api/reports/* (hanya baris periode itu, bukan seluruh
// riwayat), tanpa polling — dimuat saat dibuka, ganti periode, atau tombol refresh.

export type ReportKind = 'po' | 'gr' | 'opname';

const HEADER_BTN_H = 34;
const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const formatQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const dateDisplay = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';

const PO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'badge-gray' }, terkirim: { label: 'Terkirim', cls: 'badge-blue' },
  diterima_sebagian: { label: 'Diterima Sebagian', cls: 'badge-amber' }, diterima: { label: 'Diterima Penuh', cls: 'badge-green' },
  batal: { label: 'Dibatalkan', cls: 'badge-red' },
};
const GR_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'badge-amber' }, approved: { label: 'Approved', cls: 'badge-green' }, dibatalkan: { label: 'Dibatalkan', cls: 'badge-gray' },
};

type PoData = { rows: PoReportRow[]; summary: ReturnType<typeof summarizePo> };
type GrData = { rows: GrReportRow[]; summary: ReturnType<typeof summarizeGr> };
type OpnameData = { rows: OpnameReportRow[]; summary: ReturnType<typeof summarizeOpname> };

interface Card { label: string; value: string; tone: 'accent' | 'success' | 'danger' | 'info' | 'neutral'; Icon: React.ElementType }
const TONES = {
  accent: { bg: 'var(--accent-bg)', fg: 'var(--accent)' }, success: { bg: 'var(--success-bg)', fg: 'var(--success)' },
  danger: { bg: 'var(--danger-bg)', fg: 'var(--danger)' }, info: { bg: 'var(--surface-2)', fg: '#0284C7' }, neutral: { bg: 'var(--surface-2)', fg: 'var(--text-secondary)' },
};

const META: Record<ReportKind, { title: string; Icon: React.ElementType; api: string; file: string; searchPlaceholder: string; emptyLabel: string }> = {
  po: { title: 'LAPORAN PURCHASE ORDER', Icon: ClipboardList, api: '/api/reports/purchase-orders', file: 'laporan-po', searchPlaceholder: 'Cari no. PO atau supplier…', emptyLabel: 'Belum ada PO di periode ini' },
  gr: { title: 'LAPORAN PENERIMAAN BARANG (GR)', Icon: Boxes, api: '/api/reports/goods-receipts', file: 'laporan-gr', searchPlaceholder: 'Cari no. GR, DO, PO, atau supplier…', emptyLabel: 'Belum ada GR di periode ini' },
  opname: { title: 'LAPORAN STOK OPNAME', Icon: FileBarChart, api: '/api/reports/stock-opname', file: 'laporan-stok-opname', searchPlaceholder: 'Cari produk atau gudang…', emptyLabel: 'Belum ada selisih stok opname di periode ini' },
};

export default function ProcurementReportTab({ creds, kind }: { creds: string; kind: ReportKind }) {
  const toast = useToast();
  const storeHeader = useStoreHeader(creds);
  const meta = META[kind];

  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const { from, to } = periodRange(period, customFrom, customTo);

  const [data, setData] = useState<PoData | GrData | OpnameData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('semua');
  const [view, setView] = useViewMode(`report-${kind}`);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Generasi request — respons periode lama yang datang belakangan tidak boleh menimpa yang baru.
  const reqId = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const r = await fetch(`${meta.api}?from=${from}&to=${to}`, { headers: { 'x-admin-auth': creds } });
      if (id !== reqId.current) return;
      if (r.ok) setData(await r.json());
      else toast.error('Gagal memuat laporan.');
    } catch { if (id === reqId.current) toast.error('Gagal memuat laporan.'); }
    finally { if (id === reqId.current) setLoading(false); }
  }, [meta.api, from, to, creds]); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/set-state-in-effect -- memuat data saat periode berubah (pola sama dengan laporan lain)
  useEffect(() => { load(); }, [load]);

  const periodLabel = PERIOD_OPTIONS.find(p => p.id === period)?.label ?? '';

  // ── Susun kartu ringkasan, tabel rincian, dan rincian per supplier/gudang menurut jenis laporan ──
  const q = search.trim().toLowerCase();
  let cards: Card[] = [];
  let breakdownTitle = '';
  let breakdown: { name: string; count: number; total: number }[] = [];
  let statusOptions: { id: string; label: string }[] = [];
  let columns: { header: string; width: string; align?: 'left' | 'right' | 'center'; bold?: boolean }[] = [];
  let tableRows: (string | number)[][] = [];
  let badgeFor: ((row: string) => { label: string; cls: string }) | null = null;
  let statusColIndex = -1;
  const titleIndex = kind === 'opname' ? 3 : 1; // kolom judul kartu: No. PO / No. GR / Produk

  if (kind === 'po' && data) {
    const d = data as PoData;
    cards = [
      { label: 'Jumlah PO', value: String(d.summary.count), tone: 'info', Icon: ClipboardList },
      { label: 'Nilai PO (tanpa yang batal)', value: formatRp(d.summary.totalValue), tone: 'accent', Icon: TrendingUp },
      { label: 'Sudah Diterima (GR approved)', value: formatRp(d.summary.receivedValue), tone: 'success', Icon: Boxes },
      { label: 'Belum Diterima', value: formatRp(d.summary.outstandingValue), tone: d.summary.outstandingValue > 0 ? 'danger' : 'neutral', Icon: Wallet },
      ...(d.summary.lateCount > 0 ? [{ label: 'PO Terlambat (lewat estimasi tiba)', value: String(d.summary.lateCount), tone: 'danger' as const, Icon: AlertTriangle }] : []),
    ];
    breakdownTitle = 'Per Supplier'; breakdown = d.summary.bySupplier;
    statusOptions = [{ id: 'semua', label: 'Semua status' }, ...Object.entries(PO_STATUS).map(([id, v]) => ({ id, label: v.label }))];
    columns = [
      { header: 'No', width: '4%', align: 'center' }, { header: 'No. PO', width: '12%' }, { header: 'Tanggal', width: '9%' }, { header: 'Supplier', width: '14%' },
      { header: 'Bahan Baku', width: '25%' }, { header: 'Nilai PO', width: '11%', align: 'right', bold: true }, { header: 'Diterima', width: '11%', align: 'right' }, { header: 'Status', width: '14%', align: 'center' },
    ];
    statusColIndex = 7; badgeFor = s => PO_STATUS[s] ?? { label: s, cls: 'badge-gray' };
    tableRows = d.rows
      .filter(r => (statusFilter === 'semua' || r.status === statusFilter) && (!q || r.poNumber.toLowerCase().includes(q) || r.supplierName.toLowerCase().includes(q)))
      .map((r, i) => [i + 1, r.poNumber, dateDisplay(r.date), r.supplierName, r.items, formatRp(r.total), formatRp(Math.min(r.receivedValue, r.total)), r.late ? `${r.status}|late` : r.status]);
  } else if (kind === 'gr' && data) {
    const d = data as GrData;
    cards = [
      { label: 'Jumlah GR', value: String(d.summary.count), tone: 'info', Icon: Boxes },
      { label: 'Nilai Diterima (approved)', value: formatRp(d.summary.approvedValue), tone: 'success', Icon: TrendingUp },
      { label: 'Belum Lunas', value: formatRp(d.summary.unpaidValue), tone: d.summary.unpaidValue > 0 ? 'danger' : 'neutral', Icon: Wallet },
      { label: 'Menunggu Approve (draft)', value: formatRp(d.summary.pendingValue), tone: d.summary.pendingValue > 0 ? 'accent' : 'neutral', Icon: AlertTriangle },
    ];
    breakdownTitle = 'Per Supplier (GR approved)'; breakdown = d.summary.bySupplier;
    statusOptions = [{ id: 'semua', label: 'Semua status' }, ...Object.entries(GR_STATUS).map(([id, v]) => ({ id, label: v.label }))];
    columns = [
      { header: 'No', width: '4%', align: 'center' }, { header: 'No. GR', width: '11%' }, { header: 'No. DO', width: '15%' }, { header: 'No. PO', width: '11%' },
      { header: 'Supplier', width: '12%' }, { header: 'Tgl Terima', width: '9%' }, { header: 'Bahan Baku', width: '17%' }, { header: 'Nilai', width: '10%', align: 'right', bold: true }, { header: 'Status', width: '11%', align: 'center' },
    ];
    statusColIndex = 8; badgeFor = s => GR_STATUS[s] ?? { label: s, cls: 'badge-gray' };
    tableRows = d.rows
      .filter(r => (statusFilter === 'semua' || r.status === statusFilter)
        && (!q || r.grNumber.toLowerCase().includes(q) || r.doNumber.toLowerCase().includes(q) || r.poNumber.toLowerCase().includes(q) || r.supplierName.toLowerCase().includes(q)))
      .map((r, i) => [i + 1, r.grNumber, r.doNumber, r.poNumber, r.supplierName, dateDisplay(r.receivedDate), r.items, formatRp(r.total), r.status]);
  } else if (kind === 'opname' && data) {
    const d = data as OpnameData;
    cards = [
      { label: 'Produk Berselisih', value: String(d.summary.count), tone: 'info', Icon: FileBarChart },
      { label: 'Selisih Lebih (fisik > sistem)', value: `${formatQty(d.summary.unitsOver)} unit · ${formatRp(d.summary.gain)}`, tone: 'success', Icon: TrendingUp },
      { label: 'Selisih Kurang (fisik < sistem)', value: `${formatQty(d.summary.unitsShort)} unit · ${formatRp(d.summary.loss)}`, tone: d.summary.loss > 0 ? 'danger' : 'neutral', Icon: TrendingDown },
      { label: 'Selisih Bersih (Harga Modal)', value: formatRp(d.summary.net), tone: d.summary.net < 0 ? 'danger' : 'success', Icon: Wallet },
    ];
    breakdownTitle = 'Per Gudang (selisih bersih)'; breakdown = d.summary.byWarehouse;
    columns = [
      { header: 'No', width: '4%', align: 'center' }, { header: 'Tanggal', width: '12%' }, { header: 'Gudang', width: '16%' }, { header: 'Produk', width: '26%' },
      { header: 'Selisih', width: '10%', align: 'right' }, { header: 'Harga Modal', width: '14%', align: 'right' }, { header: 'Nilai Selisih', width: '18%', align: 'right', bold: true },
    ];
    tableRows = d.rows
      .filter(r => !q || r.productName.toLowerCase().includes(q) || r.warehouseName.toLowerCase().includes(q))
      .map((r, i) => [i + 1, dateDisplay(r.createdAt), r.warehouseName, r.productName, `${r.delta > 0 ? '+' : ''}${formatQty(r.delta)}`, formatRp(r.unitCost), `${r.value > 0 ? '+' : ''}${formatRp(r.value)}`]);
  }

  const total = tableRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const sliceFrom = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0);
  const paged = tableRows.slice(sliceFrom, Number.isFinite(pageSize) ? safePage * pageSize : undefined);
  // Baris untuk export: status ditulis sebagai teks, bukan kode.
  const plainRows = tableRows.map(r => r.map((c, i) => {
    if (i !== statusColIndex || !badgeFor) return c;
    const [code, flag] = String(c).split('|');
    return `${badgeFor(code).label}${flag === 'late' ? ' (Terlambat)' : ''}`;
  }));

  const exportExcel = async () => {
    if (total === 0) { toast.error('Tidak ada data untuk diexport.'); return; }
    setExportingXlsx(true);
    try {
      await exportSheet({
        sheet: meta.title.slice(0, 28), title: `${meta.title} — CEMILAN TEH RISMA (${from} s/d ${to})`,
        filename: `${meta.file}-${from}-sd-${to}.xlsx`,
        columns: columns.map(c => ({ header: c.header, width: Math.max(10, Math.round(parseFloat(c.width) * 1.6)) })),
        rows: plainRows,
      });
      toast.success(`Berhasil export ${total} baris ke Excel.`);
    } catch { toast.error('Gagal membuat file Excel.'); }
    finally { setExportingXlsx(false); }
  };
  const exportPdf = async () => {
    if (total === 0) { toast.error('Tidak ada data untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const generatedAt = new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(<GenericTablePDF store={storeHeader} data={{ title: meta.title, label: `${periodLabel}: ${from} s/d ${to}`, generatedAt, columns, rows: plainRows }} /> as any).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${meta.file}-${from}-sd-${to}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${total} baris ke PDF.`);
    } catch { toast.error('Gagal membuat file PDF.'); }
    finally { setExportingPdf(false); }
  };

  const [booted, setBooted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- tandai muatan awal selesai
  useEffect(() => { if (!loading) setBooted(true); }, [loading]);
  if (!booted) return <PageLoader />;

  const isEmptyPeriod = !loading && data !== null && data.rows.length === 0;

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={load} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map(p => (
          <button key={p.id} onClick={() => { setPeriod(p.id); setPage(1); }} className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={period === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); }} className="input" style={{ height: 36 }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); }} className="input" style={{ height: 36 }} />
          </div>
        )}
      </div>

      {loading ? (
        <PageLoader compact />
      ) : isEmptyPeriod ? (
        <EmptyAddCard label={meta.emptyLabel} hint={`${dateDisplay(from)} – ${dateDisplay(to)}`} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map(c => (
              <div key={c.label} className="card p-4 flex items-center gap-3" style={{ background: TONES[c.tone].bg }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(0,0,0,0.06)', color: TONES[c.tone].fg }}><c.Icon size={16} /></div>
                <div className="min-w-0">
                  <p className="text-base font-extrabold tabular leading-tight" style={{ color: TONES[c.tone].fg }}>{c.value}</p>
                  <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                </div>
              </div>
            ))}
          </div>

          {breakdown.length > 0 && (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              <p className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}>{breakdownTitle}</p>
              <div className="divide-y divide-[var(--border-2)]">
                {breakdown.map((b: SupplierBreakdown) => (
                  <div key={b.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{b.name}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{b.count} {kind === 'opname' ? 'produk' : 'dokumen'}</span>
                    <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: kind === 'opname' && b.total < 0 ? 'var(--danger)' : 'var(--success)' }}>{formatRp(b.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                <meta.Icon size={11} /> Rincian ({total})
              </p>
              <div className="flex flex-row items-center gap-2 sm:gap-3 sm:flex-1">
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder={meta.searchPlaceholder} />
                </div>
                {statusOptions.length > 0 && (
                  <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input text-xs flex-shrink-0" style={{ height: HEADER_BTN_H, width: 'auto' }}>
                    {statusOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Tooltip label="Export Excel">
                    <button onClick={exportExcel} disabled={exportingXlsx} aria-label="Export Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                    </button>
                  </Tooltip>
                  <Tooltip label="Export PDF">
                    <button onClick={exportPdf} disabled={exportingPdf} aria-label="Export PDF" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                    </button>
                  </Tooltip>
                  <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
                </div>
              </div>
            </div>

            {total === 0 ? (
              <div className="card py-10 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada data yang cocok.</p></div>
            ) : view === 'card' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {paged.map((r, ri) => {
                  const statusCell = statusColIndex >= 0 ? String(r[statusColIndex]).split('|') : null;
                  const badge = statusCell && badgeFor ? badgeFor(statusCell[0]) : null;
                  const boldIdx = columns.findIndex(c => c.bold);
                  const text = (i: number) => String(r[i]);
                  const deltaColor = (i: number) => (kind === 'opname' && (i === 4 || i === 6)) ? (text(i).startsWith('+') ? 'var(--success)' : text(i).startsWith('-') ? 'var(--danger)' : undefined) : undefined;
                  return (
                    <div key={ri} className="card overflow-hidden">
                      <div className="px-4 pt-4 pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-bold break-words min-w-0" style={{ color: 'var(--text-primary)' }}>{text(titleIndex)}</p>
                          {badge && (
                            <span className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                              <span className={`badge ${badge.cls}`}>{badge.label}</span>
                              {statusCell?.[1] === 'late' && <span className="badge badge-red">Terlambat</span>}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 space-y-1">
                          {columns.map((c, ci) => (ci === 0 || ci === titleIndex || ci === statusColIndex || ci === boldIdx) ? null : (
                            <div key={ci} className="flex items-start justify-between gap-3 text-xs">
                              <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{c.header}</span>
                              <span className="text-right font-medium break-words min-w-0" style={{ color: deltaColor(ci) ?? 'var(--text-secondary)' }}>{text(ci)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {boldIdx >= 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{columns[boldIdx].header}</span>
                          <span className="text-sm font-extrabold tabular" style={{ color: deltaColor(boldIdx) ?? 'var(--success)' }}>{text(boldIdx)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card overflow-x-auto thin-scrollbar" style={{ borderColor: 'var(--border-2)' }}>
                <table className="w-full text-xs" style={{ minWidth: 760 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      {columns.map(c => (
                        <th key={c.header} className="px-3 py-2.5 font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', textAlign: c.align ?? 'left', fontSize: 10 }}>{c.header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-2)]">
                    {paged.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((cell, ci) => {
                          const col = columns[ci];
                          if (ci === statusColIndex && badgeFor) {
                            const [code, flag] = String(cell).split('|');
                            const b = badgeFor(code);
                            return (
                              <td key={ci} className="px-3 py-2.5" style={{ textAlign: 'center' }}>
                                <span className={`badge ${b.cls}`}>{b.label}</span>
                                {flag === 'late' && <span className="badge badge-red ml-1">Terlambat</span>}
                              </td>
                            );
                          }
                          const text = String(cell);
                          const isDelta = kind === 'opname' && (ci === 4 || ci === 6);
                          const color = isDelta ? (text.startsWith('+') ? 'var(--success)' : text.startsWith('-') ? 'var(--danger)' : undefined) : undefined;
                          return (
                            <td key={ci} className="px-3 py-2.5" style={{ textAlign: col.align ?? 'left', fontWeight: col.bold ? 700 : 500, color: color ?? (ci === 0 ? 'var(--text-muted)' : 'var(--text-primary)') }}>
                              {ci === 0 ? sliceFrom + ri + 1 : text}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {total > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} baris · halaman {safePage} dari {totalPages}</p>
                  <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); setPage(1); }} />
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft size={14} /></button>
                    <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30"><ChevronRight size={14} /></button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
