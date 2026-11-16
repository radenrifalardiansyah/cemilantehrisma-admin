'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
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
import { downloadMitraExcel } from '@/components/tabs/mitra-excel';
import {
  buildMitraPaymentExcelRows, filterMitraPayments, mitraPaymentOptions, MITRA_PAYMENT_EXCEL_HEADERS,
  summarizeMitraPayments, type MitraPaymentRow,
} from '@/lib/mitra-receivables-core';

const FETCH_TIMEOUT_MS = 30_000;
const fmtTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Riwayat Pembayaran dari Mitra: semua penerimaan/cicilan rekap lintas rekap. Filter tanggal bayar diterapkan di server;
// mitra dan kata kunci disaring di klien dari data yang sudah dimuat. Pembayaran dibatalkan tampil dicoret, tak masuk total.
export default function MitraPaymentsHistory({ creds, reloadKey }: { creds: string; reloadKey: number }) {
  const toast = useToast();
  const [rows, setRows] = useState<MitraPaymentRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [locationId, setLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useViewMode('mitra-payments');
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  // Respons usang (filter berubah saat request berjalan) diabaikan lewat reqId + abort; request ber-timeout 30 detik.
  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const qs = new URLSearchParams({ includeVoided: 'true' });
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await fetch(`/api/consignment/receivables/payments?${qs}`, { headers: { 'x-admin-auth': creds }, signal: ctrl.signal });
      const d = await res.json().catch(() => null) as { payments?: MitraPaymentRow[]; truncated?: boolean; error?: string } | null;
      if (id !== reqId.current) return;
      if (!res.ok || !d?.payments) { setError(d?.error || 'Gagal memuat riwayat pembayaran.'); return; }
      setRows(d.payments); setTruncated(!!d.truncated); setError(''); setPage(1);
    } catch (err) {
      if (id !== reqId.current || signal?.aborted) return;
      console.error('Gagal memuat riwayat pembayaran mitra', err);
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

  const mitraOptions = useMemo(() => mitraPaymentOptions(rows), [rows]);
  const filtered = useMemo(() => filterMitraPayments(rows, { locationId, search }), [rows, locationId, search]);
  const summary = useMemo(() => summarizeMitraPayments(filtered), [filtered]);

  const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages);
  const paged = Number.isFinite(pageSize) ? filtered.slice((safePage - 1) * pageSize, safePage * pageSize) : filtered;
  const rowNum = (idx: number) => (Number.isFinite(pageSize) ? (safePage - 1) * pageSize : 0) + idx + 1;
  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  const exportExcel = async () => {
    if (filtered.length === 0) { toast.error('Tidak ada pembayaran untuk diexport.'); return; }
    setExporting(true);
    try {
      const { body, total } = buildMitraPaymentExcelRows(filtered, formatDueDate);
      const period = from || to ? `${from ? formatDueDate(from) : 'awal'} s/d ${to ? formatDueDate(to) : 'sekarang'}` : 'semua tanggal';
      await downloadMitraExcel({
        sheet: 'Pembayaran Mitra', title: 'RIWAYAT PEMBAYARAN MITRA — CEMILAN TEH RISMA',
        subtitle: `${filtered.length} baris (sesuai filter, ${period}) · Diexport ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        headers: MITRA_PAYMENT_EXCEL_HEADERS, body, total, moneyCols: [MITRA_PAYMENT_EXCEL_HEADERS.length], filePrefix: 'pembayaran-mitra',
      });
      toast.success(`Berhasil export ${filtered.length} pembayaran ke Excel.`);
    } catch (err) {
      console.error('Gagal export pembayaran mitra', err);
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
  const dim = (r: MitraPaymentRow): React.CSSProperties => r.voided ? { opacity: 0.55, textDecoration: 'line-through' } : {};
  const voidBadge = (r: MitraPaymentRow) => r.voided && <span className="badge badge-red flex-shrink-0">Dibatalkan</span>;

  const detail = (r: MitraPaymentRow) => (
    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs" style={{ background: 'var(--surface-2)' }}>
      <div><p className="text-[10px] uppercase font-bold" style={muted}>Dompet</p><p>{r.walletName ?? '–'}</p></div>
      <div><p className="text-[10px] uppercase font-bold" style={muted}>Dicatat oleh</p><p>{r.createdBy ?? '–'}</p></div>
      <div><p className="text-[10px] uppercase font-bold" style={muted}>Waktu dicatat</p><p>{fmtTime(r.createdAt)}</p></div>
      <div><p className="text-[10px] uppercase font-bold" style={muted}>Rekap</p><p>{formatDueDate(r.recapDate)} · total {formatRp(r.recapTotal)}</p></div>
      <div className="sm:col-span-2"><p className="text-[10px] uppercase font-bold" style={muted}>Catatan</p><p className="whitespace-pre-wrap break-words">{r.note || '–'}</p></div>
      {r.voided && <div className="sm:col-span-2"><span className="badge badge-red">Dibatalkan, tidak dihitung ke total</span></div>}
    </div>
  );

  const controlH = { height: HEADER_BTN_H } as const;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Total Diterima</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--success, var(--text-primary))' }}>{formatRp(summary.totalPaid)}</p>
          {summary.voidedCount > 0 && <p className="text-[11px]" style={muted}>{summary.voidedCount} dibatalkan (tidak dihitung)</p>}
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Jumlah Pembayaran</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--text-primary)' }}>{summary.count}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Jumlah Mitra</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--text-primary)' }}>{summary.mitraCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input text-sm w-full" style={{ paddingLeft: 38, ...controlH }}
            placeholder="Cari mitra / catatan / dompet…" aria-label="Cari pembayaran mitra" />
        </div>
        <DateInput value={from} onChange={v => { setFrom(v); setLoading(true); setPage(1); }} max={to || undefined} height={HEADER_BTN_H} style={{ width: 150 }} />
        <span className="text-xs" style={muted}>s/d</span>
        <DateInput value={to} onChange={v => { setTo(v); setLoading(true); setPage(1); }} min={from || undefined} height={HEADER_BTN_H} style={{ width: 150 }} />
        <select value={locationId} onChange={e => { setLocationId(e.target.value); setPage(1); }} aria-label="Filter mitra" className="input text-sm" style={{ width: 180, ...controlH, paddingTop: 0, paddingBottom: 0 }}>
          <option value="">Semua mitra</option>
          {mitraOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
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
          <p className="text-sm" style={muted}>{rows.length === 0 ? 'Belum ada pembayaran dari mitra pada rentang ini.' : 'Tidak ada pembayaran yang cocok dengan filter.'}</p>
        </div>
      ) : (
        <>
          {view === 'table' ? (
            <div className="card overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-2)' }}>
                    {['No', 'Tanggal bayar', 'Mitra', 'Tgl rekap', 'Dompet', 'Catatan', 'Dicatat oleh', 'Nominal', ''].map((h, i) => (
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
                            <span className="inline-flex items-center gap-1.5 flex-wrap">{r.locationName || 'Tanpa nama'}{voidBadge(r)}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap align-middle" style={dim(r)}>{formatDueDate(r.recapDate)}</td>
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
                      <p className="text-sm font-bold break-words px-6" style={{ color: 'var(--text-primary)', ...dim(r) }}>{r.locationName || 'Tanpa nama'}</p>
                      {r.voided && <div className="mt-1">{voidBadge(r)}</div>}
                      <p className="text-xs mt-1 break-words" style={{ ...muted, ...dim(r) }}>{formatDueDate(r.date)} · rekap {formatDueDate(r.recapDate)}</p>
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
