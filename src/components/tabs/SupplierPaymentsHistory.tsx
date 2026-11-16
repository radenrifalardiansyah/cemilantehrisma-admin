'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import ExcelJS from 'exceljs';
import Pagination from '@/components/Pagination';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import ViewToggle from '@/components/ViewToggle';
import { ExcelIcon } from '@/components/FileTypeIcons';
import { DateInput } from '@/components/DateTimeInput';
import { useToast } from '@/components/Toast';
import { useViewMode } from '@/lib/useViewMode';
import { HEADER_BTN_H } from '@/lib/ui-constants';
import { formatRp } from '@/lib/format';
import { formatDueDate } from '@/lib/receivable';
import {
  buildPaymentExcelRows, filterSupplierPayments, paymentDocLabel, paymentSupplierOptions,
  PAYMENT_EXCEL_HEADERS, summarizeSupplierPayments, type SupplierPaymentRow,
} from '@/lib/supplier-payments-core';

const FETCH_TIMEOUT_MS = 30_000;
const fmtTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Riwayat Pembayaran Hutang: gabungan semua pembayaran/cicilan pembelian bahan baku. Filter tanggal bayar diterapkan
// di server; supplier dan kata kunci disaring di klien dari data yang sudah dimuat.
export default function SupplierPaymentsHistory({ creds, reloadKey, onOpenPurchases }: {
  creds: string; reloadKey: number; onOpenPurchases?: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<SupplierPaymentRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplierKey, setSupplierKey] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useViewMode('supplier-payments');
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  // Spinner dinyalakan oleh pemicunya (ubah tanggal / tombol muat ulang); muat ulang via reloadKey berjalan senyap.
  // Muat dengan timeout; respons usang (filter berubah saat request berjalan) diabaikan lewat reqId + abort.
  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const qs = new URLSearchParams({ includeVoided: 'true' });
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await fetch(`/api/material-purchases/payments?${qs}`, { headers: { 'x-admin-auth': creds }, signal: ctrl.signal });
      const d = await res.json().catch(() => null) as { payments?: SupplierPaymentRow[]; truncated?: boolean; error?: string } | null;
      if (id !== reqId.current) return;
      if (!res.ok || !d?.payments) { setError(d?.error || 'Gagal memuat riwayat pembayaran.'); return; }
      setRows(d.payments); setTruncated(!!d.truncated); setError(''); setPage(1);
    } catch (err) {
      if (id !== reqId.current || signal?.aborted) return;
      console.error('Gagal memuat riwayat pembayaran hutang', err);
      setError('Gagal memuat riwayat pembayaran.');
    } finally {
      clearTimeout(timer);
      if (id === reqId.current) setLoading(false);
    }
  }, [creds, from, to]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => { await load(ctrl.signal); })();
    return () => ctrl.abort();
  }, [load, reloadKey]);

  const supplierOptions = useMemo(() => paymentSupplierOptions(rows), [rows]);
  const filtered = useMemo(() => filterSupplierPayments(rows, { supplierKey, search }), [rows, supplierKey, search]);
  const summary = useMemo(() => summarizeSupplierPayments(filtered), [filtered]);

  const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages);
  const paged = Number.isFinite(pageSize) ? filtered.slice((safePage - 1) * pageSize, safePage * pageSize) : filtered;
  const rowNum = (idx: number) => (Number.isFinite(pageSize) ? (safePage - 1) * pageSize : 0) + idx + 1;
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  const exportExcel = async () => {
    if (filtered.length === 0) { toast.error('Tidak ada pembayaran untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Pembayaran Hutang');
      const colCount = PAYMENT_EXCEL_HEADERS.length;
      const { body, total } = buildPaymentExcelRows(filtered, formatDueDate);
      ws.mergeCells(1, 1, 1, colCount);
      const title = ws.getCell(1, 1);
      title.value = 'RIWAYAT PEMBAYARAN HUTANG SUPPLIER — CEMILAN TEH RISMA';
      title.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;
      ws.mergeCells(2, 1, 2, colCount);
      const sub = ws.getCell(2, 1);
      const period = from || to ? `${from ? formatDueDate(from) : 'awal'} s/d ${to ? formatDueDate(to) : 'sekarang'}` : 'semua tanggal';
      sub.value = `${filtered.length} baris (sesuai filter, ${period}) · Diexport ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
      sub.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      sub.alignment = { horizontal: 'center', vertical: 'middle' };
      sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      const HEADER = 3;
      const hr = ws.getRow(HEADER);
      PAYMENT_EXCEL_HEADERS.forEach((h, i) => { hr.getCell(i + 1).value = h; });
      hr.height = 24;
      hr.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.views = [{ state: 'frozen', ySplit: HEADER }];
      const amtCol = colCount;
      body.forEach(r => {
        const row = ws.addRow(r);
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(amtCol).numFmt = '"Rp"#,##0';
        row.getCell(amtCol).alignment = { horizontal: 'right', vertical: 'middle' };
      });
      const tr = ws.addRow(total);
      tr.font = { bold: true };
      tr.getCell(amtCol).numFmt = '"Rp"#,##0';
      tr.getCell(amtCol).alignment = { horizontal: 'right', vertical: 'middle' };
      tr.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } }; });
      ws.columns.forEach(column => {
        let max = 8;
        for (let r = HEADER; r <= ws.rowCount; r++) { const v = ws.getRow(r).getCell(column.number!).value; const len = v == null ? 0 : v.toString().length; if (len > max) max = len; }
        column.width = Math.min(max + 2, 50);
      });
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `pembayaran-hutang-supplier-cemilantehrisma-${new Date().toLocaleDateString('en-CA')}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${filtered.length} pembayaran ke Excel.`);
    } catch (err) {
      console.error('Gagal export pembayaran hutang', err);
      toast.error('Gagal membuat file Excel.');
    } finally { setExporting(false); }
  };

  const detailButton = (id: string, open: boolean) => (
    <Tooltip label="Lihat Detail">
      <button aria-label="Lihat Detail" aria-expanded={open} onClick={() => toggle(id)} className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
        <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
    </Tooltip>
  );
  const muted = { color: 'var(--text-muted)' } as const;
  const dim = (r: SupplierPaymentRow): React.CSSProperties => r.voided ? { opacity: 0.55, textDecoration: 'line-through' } : {};
  const voidBadge = (r: SupplierPaymentRow) => r.voided && <span className="badge badge-red flex-shrink-0">Dibatalkan</span>;

  const detail = (r: SupplierPaymentRow) => (
    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs" style={{ background: 'var(--surface-2)' }}>
      <div><p className="text-[10px] uppercase font-bold" style={muted}>Dompet</p><p>{r.walletName ?? '–'}</p></div>
      <div><p className="text-[10px] uppercase font-bold" style={muted}>Dicatat oleh</p><p>{r.createdBy ?? '–'}</p></div>
      <div><p className="text-[10px] uppercase font-bold" style={muted}>Waktu dicatat</p><p>{fmtTime(r.createdAt)}</p></div>
      <div><p className="text-[10px] uppercase font-bold" style={muted}>Pembelian</p>
        <p className="flex items-center gap-2 flex-wrap">{paymentDocLabel(r)}
          {r.purchaseVoided && <span className="badge badge-red">Pembelian dibatalkan</span>}
          {onOpenPurchases && <button onClick={onOpenPurchases} className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--accent)' }}><ExternalLink size={11} /> Buka tab Pembelian</button>}
        </p>
      </div>
      <div className="sm:col-span-2"><p className="text-[10px] uppercase font-bold" style={muted}>Catatan</p><p className="whitespace-pre-wrap break-words">{r.note || '–'}</p></div>
      {r.voided && <div className="sm:col-span-2"><span className="badge badge-red">Dibatalkan, tidak dihitung ke total</span></div>}
    </div>
  );

  const controlH = { height: HEADER_BTN_H } as const;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Total Dibayar</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--success, var(--text-primary))' }}>{formatRp(summary.totalPaid)}</p>
          {summary.voidedCount > 0 && <p className="text-[11px]" style={muted}>{summary.voidedCount} dibatalkan (tidak dihitung)</p>}
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Jumlah Pembayaran</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--text-primary)' }}>{summary.count}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Jumlah Supplier</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--text-primary)' }}>{summary.supplierCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input text-sm w-full" style={{ paddingLeft: 38, ...controlH }}
            placeholder="Cari supplier / PO / GR / catatan…" aria-label="Cari pembayaran hutang" />
        </div>
        <DateInput value={from} onChange={v => { setFrom(v); setLoading(true); setPage(1); }} max={to || undefined} height={HEADER_BTN_H} style={{ width: 150 }} />
        <span className="text-xs" style={muted}>s/d</span>
        <DateInput value={to} onChange={v => { setTo(v); setLoading(true); setPage(1); }} min={from || undefined} height={HEADER_BTN_H} style={{ width: 150 }} />
        <select value={supplierKey} onChange={e => { setSupplierKey(e.target.value); setPage(1); }} aria-label="Filter supplier" className="input text-sm" style={{ width: 180, ...controlH, paddingTop: 0, paddingBottom: 0 }}>
          <option value="">Semua supplier</option>
          {supplierOptions.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}
        </select>
        <Tooltip label="Muat ulang">
          <button onClick={() => { setLoading(true); void load(); }} disabled={loading} aria-label="Muat ulang" className="btn-ghost p-0 flex items-center justify-center" style={{ ...controlH, width: HEADER_BTN_H }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </Tooltip>
        {filtered.length > 0 && (
          <Tooltip label="Export Excel">
            <button onClick={() => void exportExcel()} disabled={exporting} aria-label="Export Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ ...controlH, width: HEADER_BTN_H }}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
            </button>
          </Tooltip>
        )}
        {rows.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
      </div>

      {truncated && !error && (
        <p className="text-xs" style={{ color: 'var(--warning, var(--text-muted))' }}>Hanya 1000 pembayaran terbaru yang ditampilkan. Persempit rentang tanggal untuk melihat yang lebih lama.</p>
      )}

      {loading && rows.length === 0 && !error ? (
        <PageLoader compact />
      ) : error ? (
        <div className="card py-10 text-center"><p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>{error}</p></div>
      ) : filtered.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="text-sm" style={muted}>{rows.length === 0 ? 'Belum ada pembayaran hutang supplier pada rentang ini.' : 'Tidak ada pembayaran yang cocok dengan filter.'}</p>
        </div>
      ) : (
        <>
          {view === 'table' ? (
            <div className="card overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-2)' }}>
                    {['No', 'Tanggal bayar', 'Supplier', 'PO/GR', 'Dompet', 'Catatan', 'Dibayar oleh', 'Nominal', ''].map((h, i) => (
                      <th key={i} className={`px-3 py-2 font-semibold whitespace-nowrap ${h === 'Nominal' ? 'text-right' : 'text-left'}`} style={muted}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r, idx) => {
                    const open = expanded.has(r.id);
                    return (
                      <Fragment key={r.id}>
                        <tr style={{ borderTop: '1px solid var(--border-2)' }}>
                          <td className="px-3 py-2 tabular align-middle" style={muted}>{rowNum(idx)}</td>
                          <td className="px-3 py-2 whitespace-nowrap align-middle" style={dim(r)}>{formatDueDate(r.date)}</td>
                          <td className="px-3 py-2 align-middle font-semibold" style={dim(r)}>
                            <span className="inline-flex items-center gap-1.5 flex-wrap">{r.supplierName || 'Tanpa nama'}{voidBadge(r)}</span>
                          </td>
                          <td className="px-3 py-2 align-middle" style={dim(r)}>{paymentDocLabel(r)}</td>
                          <td className="px-3 py-2 align-middle whitespace-nowrap" style={dim(r)}>{r.walletName ?? '–'}</td>
                          <td className="px-3 py-2 align-middle max-w-[220px] truncate" title={r.note} style={dim(r)}>{r.note || '–'}</td>
                          <td className="px-3 py-2 align-middle whitespace-nowrap" style={dim(r)}>{r.createdBy ?? '–'}</td>
                          <td className="px-3 py-2 align-middle text-right tabular font-bold whitespace-nowrap" style={dim(r)}>{formatRp(r.amount)}</td>
                          <td className="px-3 py-2 align-middle"><div className="flex justify-end">{detailButton(r.id, open)}</div></td>
                        </tr>
                        {open && <tr><td colSpan={9} style={{ borderTop: '1px solid var(--border-2)' }}>{detail(r)}</td></tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
              {paged.map((r, idx) => {
                const open = expanded.has(r.id);
                return (
                  <div key={r.id} className="card overflow-hidden relative">
                    <div className="absolute top-2.5 right-2.5 z-10">{detailButton(r.id, open)}</div>
                    <div className="pt-3 pb-3 px-4 text-center">
                      <span className="text-[11px] font-bold tabular-nums" style={muted}>#{rowNum(idx)}</span>
                      <p className="text-sm font-bold break-words px-6" style={{ color: 'var(--text-primary)', ...dim(r) }}>{r.supplierName || 'Tanpa nama'}</p>
                      {r.voided && <div className="mt-1">{voidBadge(r)}</div>}
                      <p className="text-xs mt-1 break-words" style={{ ...muted, ...dim(r) }}>{formatDueDate(r.date)} · {paymentDocLabel(r)}</p>
                      <p className="text-xs break-words" style={{ ...muted, ...dim(r) }}>{r.walletName ?? '–'}{r.note ? ` · ${r.note}` : ''}</p>
                      <p className="text-base font-extrabold tabular mt-2" style={{ color: 'var(--text-primary)', ...dim(r) }}>{formatRp(r.amount)}</p>
                    </div>
                    {open && <div style={{ borderTop: '1px solid var(--border-2)' }}>{detail(r)}</div>}
                  </div>
                );
              })}
            </div>
          )}
          <Pagination total={filtered.length} safePage={safePage} totalPages={totalPages} pageSize={pageSize}
            onPageSize={n => { setPageSize(n); setPage(1); }} onGoPage={setPage} unit="pembayaran" />
        </>
      )}
    </div>
  );
}
