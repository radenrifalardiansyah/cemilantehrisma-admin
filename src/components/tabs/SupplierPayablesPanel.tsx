'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, HandCoins, Loader2, RefreshCw, Search } from 'lucide-react';
import Pagination from '@/components/Pagination';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import PurchasePaymentDialog, { type PayTarget } from '@/components/tabs/PurchasePaymentDialog';
import { formatRp } from '@/lib/format';
import { formatDueDate } from '@/lib/receivable';
import {
  groupPayablesBySupplier, isAlertStatus, PAYMENT_STATE_LABEL, summarizePayables,
  type PayableRow, type SupplierPayable,
} from '@/lib/payables-core';

type DueFilter = 'all' | 'alert' | 'overdue';

const FETCH_TIMEOUT_MS = 30_000;
const ctl = 'sm:!py-0 sm:!h-[30px] sm:!text-xs';

function DueBadge({ row }: { row: Pick<PayableRow, 'dueDate' | 'dueStatus' | 'dueDays'> }) {
  if (!row.dueDate) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>–</span>;
  const label = formatDueDate(row.dueDate);
  if (row.dueStatus === 'overdue') return <span className="badge badge-red" title={label}>Lewat {row.dueDays} hari</span>;
  if (row.dueStatus === 'today') return <span className="badge badge-amber" title={label}>Hari ini</span>;
  if (row.dueStatus === 'soon') return <span className="badge badge-amber" title={label}>H-{row.dueDays}</span>;
  return <span className="text-xs tabular" style={{ color: 'var(--text-secondary)' }}>{label}</span>;
}

// Hutang Supplier: rekap hutang pembelian bahan baku per supplier (total, jumlah pembelian, jatuh tempo terdekat,
// yang lewat jatuh tempo) dengan daftar pembelian per supplier dan tombol Bayar (cicilan atau lunas).
export default function SupplierPayablesPanel({ creds, canEdit, reloadKey, onChanged }: {
  creds: string; canEdit: boolean; reloadKey: number; onChanged: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<PayableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState<DueFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null);

  const applyData = useCallback((d: { suppliers: SupplierPayable[] }) => { setRows(d.suppliers.flatMap(s => s.items)); setError(''); }, []);

  // Ambil rekap dengan timeout; mengembalikan null bila gagal (pesan error sudah diset).
  const fetchPayables = useCallback(async (signal?: AbortSignal) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await fetch('/api/material-purchases/payables', { headers: { 'x-admin-auth': creds }, signal: ctrl.signal });
      if (!res.ok) { setError('Gagal memuat hutang supplier.'); return null; }
      return await res.json() as { suppliers: SupplierPayable[] };
    } catch (err) {
      if (!signal?.aborted) { console.error('Gagal memuat hutang supplier', err); setError('Gagal memuat hutang supplier.'); }
      return null;
    } finally { clearTimeout(timer); }
  }, [creds]);

  const reload = async () => {
    setLoading(true);
    const d = await fetchPayables();
    if (d) applyData(d);
    setLoading(false);
  };

  // Muat awal & muat ulang saat reloadKey berubah (senyap, tanpa spinner penuh).
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const d = await fetchPayables(ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (d) applyData(d);
      setLoading(false);
    })();
    return () => ctrl.abort();
  }, [fetchPayables, applyData, reloadKey]);

  const summary = useMemo(() => summarizePayables(rows), [rows]);

  // Filter di sisi klien: cari (supplier / no PO / no GR) dan status jatuh tempo, lalu dikelompokkan ulang per supplier.
  const suppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter(r =>
      (dueFilter === 'all' || (dueFilter === 'overdue' ? r.dueStatus === 'overdue' : isAlertStatus(r.dueStatus)))
      && (!q || [r.supplierName, r.poNumber, r.grNumber].some(t => (t ?? '').toLowerCase().includes(q))));
    return groupPayablesBySupplier(filtered);
  }, [rows, search, dueFilter]);

  const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(suppliers.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages);
  const paged = Number.isFinite(pageSize) ? suppliers.slice((safePage - 1) * pageSize, safePage * pageSize) : suppliers;
  const rowNum = (idx: number) => (Number.isFinite(pageSize) ? (safePage - 1) * pageSize : 0) + idx + 1;

  const toggle = (key: string) => setExpanded(s => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; });
  const openPay = (r: PayableRow) => setPayTarget({ id: r.id, supplierName: r.supplierName, total: r.total, remaining: r.remaining, dueDate: r.dueDate, walletId: r.walletId });
  const afterPay = async () => { await onChanged(); const d = await fetchPayables(); if (d) applyData(d); };

  const payButton = (r: PayableRow) => canEdit && (
    <button onClick={() => openPay(r)} className="btn-primary flex-shrink-0 text-xs h-10 sm:h-[30px] px-3">
      <HandCoins size={12} /> Bayar
    </button>
  );

  // Daftar pembelian satu supplier (dipakai tabel desktop dan kartu mobile).
  const itemsOf = (g: SupplierPayable) => (
    <div className="divide-y divide-[var(--border-2)]" style={{ background: 'var(--surface-2)' }}>
      {g.items.map(r => (
        <div key={r.id} className="px-4 py-3 flex flex-col gap-2 md:grid md:items-center md:gap-3 md:grid-cols-[minmax(0,1.4fr)_88px_120px_120px_120px_130px_96px]">
          <div className="min-w-0">
            <p className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{[r.poNumber, r.grNumber].filter(Boolean).join(' · ') || 'Pembelian manual'}</p>
            <p className="text-[11px] mt-0.5 md:hidden" style={{ color: 'var(--text-muted)' }}>{formatDueDate(r.date)}</p>
          </div>
          <span className="hidden md:block text-xs tabular" style={{ color: 'var(--text-secondary)' }}>{r.date}</span>
          <div className="grid grid-cols-3 gap-2 md:contents">
            <div className="md:text-right"><p className="text-[10px] uppercase font-bold md:hidden" style={{ color: 'var(--text-muted)' }}>Total</p><span className="text-xs tabular">{formatRp(r.total)}</span></div>
            <div className="md:text-right"><p className="text-[10px] uppercase font-bold md:hidden" style={{ color: 'var(--text-muted)' }}>Dibayar</p><span className="text-xs tabular">{r.paid > 0 ? formatRp(r.paid) : '–'}</span></div>
            <div className="md:text-right"><p className="text-[10px] uppercase font-bold md:hidden" style={{ color: 'var(--text-muted)' }}>Sisa</p><span className="text-xs font-bold tabular" style={{ color: 'var(--danger)' }}>{formatRp(r.remaining)}</span></div>
          </div>
          <div className="flex items-center gap-2 md:justify-end">
            <span className="text-[10px] uppercase font-bold md:hidden" style={{ color: 'var(--text-muted)' }}>Jatuh tempo</span>
            <DueBadge row={r} />
            {r.state === 'sebagian' && <span className="badge badge-blue">{PAYMENT_STATE_LABEL.sebagian}</span>}
          </div>
          <div className="md:flex md:justify-end">{payButton(r)}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="p-4 lg:p-6 animate-fade-up space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Total Hutang</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--danger)' }}>{formatRp(summary.totalDebt)}</p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{summary.count} pembelian</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Supplier Berhutang</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: 'var(--text-primary)' }}>{summary.supplierCount}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Lewat Jatuh Tempo</p>
          <p className="text-lg font-extrabold tabular mt-0.5" style={{ color: summary.overdueCount > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{formatRp(summary.overdueAmount)}</p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{summary.overdueCount} pembelian</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className={`input w-full ${ctl}`} style={{ paddingLeft: 38 }}
            placeholder="Cari supplier / no. PO / no. GR…" aria-label="Cari hutang supplier" />
        </div>
        <select value={dueFilter} onChange={e => { setDueFilter(e.target.value as DueFilter); setPage(1); }} aria-label="Filter jatuh tempo" className={`input ${ctl}`} style={{ width: 190 }}>
          <option value="all">Semua hutang</option>
          <option value="alert">Jatuh tempo ≤ 3 hari / lewat</option>
          <option value="overdue">Lewat jatuh tempo</option>
        </select>
        <Tooltip label="Muat ulang">
          <button onClick={reload} disabled={loading} aria-label="Muat ulang" className="btn-ghost p-0 flex items-center justify-center h-10 w-10 sm:h-[30px] sm:w-[30px]">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </Tooltip>
      </div>

      {loading && rows.length === 0 ? (
        <PageLoader compact />
      ) : error ? (
        <div className="card py-10 text-center"><p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>{error}</p></div>
      ) : suppliers.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{rows.length === 0 ? 'Tidak ada hutang supplier. Semua pembelian sudah lunas.' : 'Tidak ada hutang yang cocok dengan filter.'}</p>
        </div>
      ) : (
        <>
          {/* Desktop: tabel bernomor */}
          <div className="hidden md:block card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
            <div className="grid items-center gap-3 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider grid-cols-[28px_minmax(0,1.6fr)_90px_150px_150px_140px]" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              <span className="text-center">No</span><span>Supplier</span><span className="text-right">Pembelian</span>
              <span>Jatuh tempo terdekat</span><span className="text-right">Lewat jatuh tempo</span><span className="text-right">Total hutang</span>
            </div>
            <div className="divide-y divide-[var(--border-2)]">
              {paged.map((g, idx) => {
                const open = expanded.has(g.key);
                return (
                  <Fragment key={g.key}>
                    <button onClick={() => toggle(g.key)} aria-expanded={open}
                      className="w-full grid items-center gap-3 px-4 py-3 text-left grid-cols-[28px_minmax(0,1.6fr)_90px_150px_150px_140px]">
                      <span className="text-[11px] font-bold tabular text-center" style={{ color: 'var(--text-muted)' }}>{rowNum(idx)}</span>
                      <span className="flex items-center gap-1.5 min-w-0">
                        {open ? <ChevronDown size={14} className="flex-shrink-0" /> : <ChevronRight size={14} className="flex-shrink-0" />}
                        <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{g.supplierName}</span>
                      </span>
                      <span className="text-xs tabular text-right">{g.count}</span>
                      <span className="text-xs tabular">{g.nearestDue ? formatDueDate(g.nearestDue) : '–'}</span>
                      <span className="text-xs tabular text-right" style={{ color: g.overdueCount > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {g.overdueCount > 0 ? <>{formatRp(g.overdueAmount)} <span className="font-semibold">({g.overdueCount})</span></> : '–'}
                      </span>
                      <span className="text-sm font-extrabold tabular text-right" style={{ color: 'var(--danger)' }}>{formatRp(g.totalDebt)}</span>
                    </button>
                    {open && (
                      <div>
                        <div className="grid gap-3 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider grid-cols-[minmax(0,1.4fr)_88px_120px_120px_120px_130px_96px]" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-2)' }}>
                          <span>PO / GR</span><span>Tanggal</span><span className="text-right">Total</span><span className="text-right">Dibayar</span>
                          <span className="text-right">Sisa</span><span className="text-right">Jatuh tempo</span><span />
                        </div>
                        {itemsOf(g)}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>

          {/* Mobile: kartu per supplier */}
          <div className="md:hidden space-y-3">
            {paged.map((g, idx) => {
              const open = expanded.has(g.key);
              return (
                <div key={g.key} className="card overflow-hidden">
                  <button onClick={() => toggle(g.key)} aria-expanded={open} className="w-full px-4 py-3 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold tabular flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{rowNum(idx)}</span>
                      <p className="text-sm font-bold flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>{g.supplierName}</p>
                      {open ? <ChevronDown size={14} className="flex-shrink-0" /> : <ChevronRight size={14} className="flex-shrink-0" />}
                    </div>
                    <p className="text-base font-extrabold tabular mt-1" style={{ color: 'var(--danger)' }}>{formatRp(g.totalDebt)}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      <span>{g.count} pembelian</span>
                      <span>Terdekat: {g.nearestDue ? formatDueDate(g.nearestDue) : '–'}</span>
                      {g.overdueCount > 0 && <span className="font-semibold inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}><AlertTriangle size={11} /> Lewat {formatRp(g.overdueAmount)} ({g.overdueCount})</span>}
                    </div>
                  </button>
                  {open && <div style={{ borderTop: '1px solid var(--border-2)' }}>{itemsOf(g)}</div>}
                </div>
              );
            })}
          </div>

          <Pagination total={suppliers.length} safePage={safePage} totalPages={totalPages} pageSize={pageSize}
            onPageSize={n => { setPageSize(n); setPage(1); }} onGoPage={setPage} unit="supplier" />
        </>
      )}

      {payTarget && <PurchasePaymentDialog creds={creds} purchase={payTarget} canEdit={canEdit} onClose={() => setPayTarget(null)} onDone={afterPay} />}
    </div>
  );
}
