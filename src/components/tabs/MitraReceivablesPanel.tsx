'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, HandCoins, Loader2, RefreshCw, Search } from 'lucide-react';
import Pagination from '@/components/Pagination';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import ViewToggle from '@/components/ViewToggle';
import { ExcelIcon } from '@/components/FileTypeIcons';
import { useToast } from '@/components/Toast';
import { useViewMode } from '@/lib/useViewMode';
import { HEADER_BTN_H } from '@/lib/ui-constants';
import MitraPaymentsHistory from '@/components/tabs/MitraPaymentsHistory';
import RecapPaymentDialog, { type RecapPayTarget } from '@/components/tabs/RecapPaymentDialog';
import { downloadMitraExcel } from '@/components/tabs/mitra-excel';
import { formatRp } from '@/lib/format';
import { formatDueDate } from '@/lib/receivable';
import {
  buildReceivableExcelRows, filterReceivables, groupReceivablesByMitra, receivablesAlertMessage, RECEIVABLE_EXCEL_HEADERS,
  summarizeReceivables, type MitraReceivable, type ReceivableDueFilter, type ReceivableItem,
} from '@/lib/mitra-receivables-core';

type Section = 'active' | 'history';
const SECTIONS: { id: Section; label: string }[] = [{ id: 'active', label: 'Piutang Aktif' }, { id: 'history', label: 'Riwayat Pembayaran' }];
const FETCH_TIMEOUT_MS = 30_000;
const muted = { color: 'var(--text-muted)' } as const;

function DueBadge({ row }: { row: Pick<ReceivableItem, 'dueDate' | 'dueStatus' | 'dueDays'> }) {
  if (!row.dueDate) return <span className="text-xs" style={muted}>–</span>;
  const label = formatDueDate(row.dueDate);
  if (row.dueStatus === 'overdue') return <span className="badge badge-red" title={label}>Lewat {row.dueDays} hari</span>;
  if (row.dueStatus === 'today') return <span className="badge badge-amber" title={label}>Hari ini</span>;
  if (row.dueStatus === 'soon') return <span className="badge badge-amber" title={label}>H-{row.dueDays}</span>;
  return <span className="text-xs tabular" style={{ color: 'var(--text-secondary)' }}>{label}</span>;
}

// Piutang Mitra: sisa rekap belum lunas (termasuk yang sudah dicicil) per mitra, dengan umur piutang, jatuh tempo, dan
// tombol Bayar (hanya `canEdit`) yang membuka dialog pembayaran rekap yang sama dengan tab Rekap Harian.
// `onChanged` dipanggil setelah pembayaran (muat ulang daftar rekap induk + saldo dompet).
export default function MitraReceivablesPanel({ creds, canEdit, onChanged }: {
  creds: string; canEdit: boolean; onChanged: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [section, setSection] = useState<Section>('active');
  const [rows, setRows] = useState<ReceivableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState<ReceivableDueFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useViewMode('mitra-receivables');
  const [payTarget, setPayTarget] = useState<RecapPayTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  // Muat piutang dengan timeout; respons usang (muat ulang beruntun) diabaikan lewat reqId. Mengembalikan true bila sukses.
  const fetchReceivables = useCallback(async (signal?: AbortSignal) => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await fetch('/api/consignment/receivables', { headers: { 'x-admin-auth': creds }, signal: ctrl.signal });
      const d = await res.json().catch(() => null) as { mitras?: MitraReceivable[]; error?: string } | null;
      if (id !== reqId.current) return;
      if (!res.ok || !d?.mitras) { setError(d?.error || 'Gagal memuat piutang mitra.'); return; }
      setRows(d.mitras.flatMap(m => m.items)); setError('');
    } catch (err) {
      if (id !== reqId.current || signal?.aborted) return;
      console.error('Gagal memuat piutang mitra', err);
      setError('Gagal memuat piutang mitra.');
    } finally {
      clearTimeout(timer);
      if (id === reqId.current) setLoading(false);
    }
  }, [creds]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => { await fetchReceivables(ctrl.signal); })();
    return () => ctrl.abort();
  }, [fetchReceivables]);

  const summary = useMemo(() => summarizeReceivables(rows), [rows]);
  const alertText = useMemo(() => receivablesAlertMessage(summary), [summary]);

  // Filter di klien: cari mitra + status jatuh tempo, lalu dikelompokkan ulang per mitra.
  const mitras = useMemo(() => groupReceivablesByMitra(filterReceivables(rows, { due: dueFilter, search })), [rows, dueFilter, search]);
  const filteredItems = useMemo(() => mitras.flatMap(m => m.items), [mitras]);

  const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(mitras.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages);
  const paged = Number.isFinite(pageSize) ? mitras.slice((safePage - 1) * pageSize, safePage * pageSize) : mitras;
  const rowNum = (idx: number) => (Number.isFinite(pageSize) ? (safePage - 1) * pageSize : 0) + idx + 1;

  const toggle = (key: string) => setExpanded(s => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; });
  const reload = async () => { setLoading(true); await fetchReceivables(); };
  const openPay = (r: ReceivableItem) => setPayTarget({ id: r.recapId, locationName: r.locationName, total: r.total, remaining: r.remaining, walletId: r.walletId });
  const afterPay = async () => { await onChanged(); await fetchReceivables(); };

  const exportExcel = async () => {
    if (filteredItems.length === 0) { toast.error('Tidak ada piutang untuk diexport.'); return; }
    setExporting(true);
    try {
      const { body, total } = buildReceivableExcelRows(filteredItems, formatDueDate);
      await downloadMitraExcel({
        sheet: 'Piutang Mitra', title: 'PIUTANG MITRA — CEMILAN TEH RISMA',
        subtitle: `${filteredItems.length} rekap dari ${mitras.length} mitra (sesuai filter) · Diexport ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        headers: RECEIVABLE_EXCEL_HEADERS, body, total, moneyCols: [4, 5, 9], filePrefix: 'piutang-mitra',
      });
      toast.success(`Berhasil export ${filteredItems.length} rekap ke Excel.`);
    } catch (err) {
      console.error('Gagal export piutang mitra', err);
      toast.error('Gagal membuat file Excel.');
    } finally { setExporting(false); }
  };

  const payButton = (r: ReceivableItem) => canEdit && (
    <button onClick={() => openPay(r)} className="btn-ghost px-2.5 py-1 text-xs font-semibold flex-shrink-0" style={{ color: 'var(--accent)' }}>
      <HandCoins size={12} /> Bayar
    </button>
  );

  const detailButton = (key: string, open: boolean) => (
    <Tooltip label="Lihat Detail">
      <button aria-label="Lihat Detail" aria-expanded={open} onClick={() => toggle(key)} className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
        <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
    </Tooltip>
  );

  // Daftar rekap satu mitra (dipakai tabel desktop dan kartu mobile).
  const itemsOf = (g: MitraReceivable) => (
    <div className="divide-y divide-[var(--border-2)]" style={{ background: 'var(--surface-2)' }}>
      {g.items.map(r => (
        <div key={r.recapId} className="px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Rekap {formatDueDate(r.date)}</p>
              <p className="text-[11px] mt-0.5" style={muted}>Umur {r.ageDays} hari</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
              <DueBadge row={r} />
              {r.state === 'sebagian' && <span className="badge badge-blue">Sebagian</span>}
              {payButton(r)}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><p className="text-[10px] uppercase font-bold" style={muted}>Total</p><span className="text-xs tabular">{formatRp(r.total)}</span></div>
            <div><p className="text-[10px] uppercase font-bold" style={muted}>Dibayar</p><span className="text-xs tabular">{r.paid > 0 ? formatRp(r.paid) : '–'}</span></div>
            <div><p className="text-[10px] uppercase font-bold" style={muted}>Sisa</p><span className="text-xs font-bold tabular" style={{ color: 'var(--danger)' }}>{formatRp(r.remaining)}</span></div>
          </div>
        </div>
      ))}
    </div>
  );

  const soonAmount = Math.max(0, summary.alertAmount - summary.overdueAmount);
  const soonCount = summary.alertCount - summary.overdueCount;
  const aging: { label: string; b: { count: number; amount: number } }[] = [
    { label: '0–7 hari', b: summary.aging.b0_7 }, { label: '8–30 hari', b: summary.aging.b8_30 },
    { label: '> 30 hari', b: summary.aging.b31_plus },
  ];

  // Dialog dirender di LUAR pembungkus animate-fade-up: elemen ber-`transform` menjadi acuan posisi `fixed`,
  // sehingga overlay modal di dalamnya terkurung di kotak panel (bukan menutupi layar).
  return (
    <>
    <div className="p-4 lg:p-6 animate-fade-up space-y-4">
      <div className="inline-flex max-w-full rounded-xl overflow-x-auto no-scrollbar border" style={{ borderColor: 'var(--border)' }}>
        {SECTIONS.map(t => (
          <button key={t.id} onClick={() => setSection(t.id)} aria-pressed={section === t.id}
            className="px-4 py-2 text-xs font-bold transition-all whitespace-nowrap flex-shrink-0"
            style={section === t.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {section === 'history' ? (
        <MitraPaymentsHistory creds={creds} reloadKey={0} />
      ) : (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Total Piutang</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--danger)' }}>{formatRp(summary.totalReceivable)}</p>
          <p className="text-[11px]" style={muted}>{summary.recapCount} rekap · {summary.mitraCount} mitra</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Lewat Jatuh Tempo</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: summary.overdueCount > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{formatRp(summary.overdueAmount)}</p>
          <p className="text-[11px]" style={muted}>{summary.overdueCount} rekap</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={muted}>Jatuh Tempo ≤ 3 Hari</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--text-primary)' }}>{formatRp(soonAmount)}</p>
          <p className="text-[11px]" style={muted}>{soonCount} rekap</p>
        </div>
      </div>

      <div className="card px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={muted}>Umur Piutang (dari tanggal rekap)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {aging.map(a => (
            <div key={a.label} className="min-w-0">
              <p className="text-[11px]" style={muted}>{a.label}</p>
              <p className="text-sm font-bold tabular truncate" style={{ color: 'var(--text-primary)' }}>{formatRp(a.b.amount)}</p>
              <p className="text-[11px]" style={muted}>{a.b.count} rekap</p>
            </div>
          ))}
        </div>
      </div>

      {alertText && !error && (
        <div className="card px-4 py-3 flex items-start gap-2" style={{ borderColor: 'var(--danger)' }} role="alert">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>{alertText}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }}
            placeholder="Cari mitra…" aria-label="Cari piutang mitra" />
        </div>
        <select value={dueFilter} onChange={e => { setDueFilter(e.target.value as ReceivableDueFilter); setPage(1); }} aria-label="Filter jatuh tempo" className="input text-sm" style={{ width: 190, height: HEADER_BTN_H, paddingTop: 0, paddingBottom: 0 }}>
          <option value="all">Semua piutang</option>
          <option value="overdue">Lewat jatuh tempo</option>
          <option value="soon">Segera (≤ 3 hari)</option>
        </select>
        <Tooltip label="Muat ulang">
          <button onClick={() => void reload()} disabled={loading} aria-label="Muat ulang" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </Tooltip>
        {filteredItems.length > 0 && (
          <Tooltip label="Export Excel">
            <button onClick={() => void exportExcel()} disabled={exporting} aria-label="Export Excel" className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
            </button>
          </Tooltip>
        )}
        {rows.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
      </div>

      {loading && rows.length === 0 && !error ? (
        <PageLoader compact />
      ) : error ? (
        <div className="card py-10 text-center"><p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>{error}</p></div>
      ) : mitras.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="text-sm" style={muted}>{rows.length === 0 ? 'Tidak ada piutang mitra. Semua rekap sudah lunas.' : 'Tidak ada piutang yang cocok dengan filter.'}</p>
        </div>
      ) : (
        <>
          {view === 'table' ? (
            <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
              {paged.map((g, idx) => {
                const open = expanded.has(g.locationId);
                return (
                  <div key={g.locationId}>
                    <div className="w-full px-4 py-3 text-left flex items-center gap-3">
                      <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center" style={muted}>{rowNum(idx)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{g.locationName}</p>
                          {g.overdueCount > 0 && <span className="badge badge-red flex-shrink-0"><AlertTriangle size={10} /> Lewat {formatRp(g.overdueAmount)} ({g.overdueCount})</span>}
                        </div>
                        <p className="text-xs mt-0.5" style={muted}>
                          {g.recapCount} rekap · Terlama {g.oldestDays} hari · Jatuh tempo terdekat: {g.nearestDue ? formatDueDate(g.nearestDue) : '–'}
                        </p>
                      </div>
                      <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--danger)' }}>{formatRp(g.totalReceivable)}</span>
                      {detailButton(g.locationId, open)}
                    </div>
                    {open && <div style={{ borderTop: '1px solid var(--border-2)' }}>{itemsOf(g)}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
              {paged.map((g, idx) => {
                const open = expanded.has(g.locationId);
                return (
                  <div key={g.locationId} className="card overflow-hidden relative">
                    <div className="absolute top-2.5 right-2.5 z-10">{detailButton(g.locationId, open)}</div>
                    <div className="w-full pt-3 pb-3 px-4 text-center">
                      <span className="text-[11px] font-bold tabular-nums" style={muted}>#{rowNum(idx)}</span>
                      <p className="text-sm font-bold break-words px-6" style={{ color: 'var(--text-primary)' }}>{g.locationName}</p>
                      {g.overdueCount > 0 && <div className="mt-1"><span className="badge badge-red"><AlertTriangle size={10} /> Lewat {formatRp(g.overdueAmount)} ({g.overdueCount})</span></div>}
                      <p className="text-xs mt-1" style={muted}>
                        {g.recapCount} rekap · Terlama {g.oldestDays} hari · Terdekat: {g.nearestDue ? formatDueDate(g.nearestDue) : '–'}
                      </p>
                      <p className="text-base font-extrabold tabular mt-2" style={{ color: 'var(--danger)' }}>{formatRp(g.totalReceivable)}</p>
                    </div>
                    {open && <div style={{ borderTop: '1px solid var(--border-2)' }}>{itemsOf(g)}</div>}
                  </div>
                );
              })}
            </div>
          )}

          <Pagination total={mitras.length} safePage={safePage} totalPages={totalPages} pageSize={pageSize}
            onPageSize={n => { setPageSize(n); setPage(1); }} onGoPage={setPage} unit="mitra" />
        </>
      )}
      </>
      )}
    </div>
    {payTarget && <RecapPaymentDialog creds={creds} recap={payTarget} canEdit={canEdit} onClose={() => setPayTarget(null)} onDone={afterPay} />}
    </>
  );
}
