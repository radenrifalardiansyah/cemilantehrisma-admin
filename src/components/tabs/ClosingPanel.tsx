'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock, Unlock, History as HistoryIcon, ChevronDown, X, Clock, Wallet, MessageCircle, ArrowRightLeft, Unlink } from 'lucide-react';
import { PdfIcon } from '@/components/FileTypeIcons';
import Tooltip from '@/components/Tooltip';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import { DateInput } from '@/components/DateTimeInput';
import type { Action } from '@/types/rbac';
import { formatRp } from '@/lib/format';
import { normalizePhone } from '@/lib/phone';
import Field from '@/components/Field';
import Modal from '@/components/Modal';
import ClosingSettlementDialog from '@/components/tabs/ClosingSettlementDialog';
import { SETTLEMENT_STATUS_LABEL, type SettlementStatus } from '@/lib/closing-settlement-core';
import { useConfirm } from '@/components/Confirm';

const formatQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const fmtDay = (d: string | null) => {
  if (!d) return '–';
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

interface Totals { count: number; qty: number; cogs: number; revenue: number }
interface Line {
  key: string; kind: 'order' | 'payment' | 'recap'; invoiceNo: string; party: string;
  txDate: string; paidDate: string | null; qty: number; cogs: number; revenue: number; note?: string;
}
interface Pending {
  upTo: string; today: string; lastClosingTo: string | null;
  paid: { totals: Totals; closable: Totals; lines: Line[]; truncated: boolean };
  receivable: { totals: Totals; lines: Line[]; truncated: boolean };
}
interface ClosingItem {
  id: string; periodFrom: string | null; periodTo: string; closedAt: string; closedBy: string;
  totalQty: number | null; totalCogs: number | null; totalRevenue: number | null; itemCount: number; note: string;
  status: 'aktif' | 'dibuka_ulang'; reopenedAt: string | null; reopenedBy: string; reopenReason: string; isOpeningBalance: boolean;
  // Status transfer closing (null = tidak berlaku: saldo awal / dibuka ulang)
  settledAmount: number; settlementStatus: SettlementStatus | null; settlementRemaining: number | null;
  settlements: { id: string; walletTransferId: string; amount: number; date: string; fromWalletName: string; toWalletName: string; createdBy: string }[];
}
const SETTLE_BADGE: Record<SettlementStatus, string> = { belum: 'badge-red', sebagian: 'badge-amber', sudah: 'badge-green' };

const DETAIL_LIMIT = 100;

export default function ClosingPanel({ creds, can, canWallet, isSuperAdmin, onChanged }: {
  creds: string; can: (action: Action) => boolean; canWallet: (action: Action) => boolean; isSuperAdmin: boolean; onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };

  const [pending, setPending] = useState<Pending | null>(null);
  const [closings, setClosings] = useState<ClosingItem[]>([]);
  const [latestActiveId, setLatestActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'paid' | 'receivable'>('paid');
  const [showHistory, setShowHistory] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  // Filter rincian: terpisah untuk tiap tab (Sudah dibayar / Belum dibayar).
  const EMPTY_DF = { q: '', from: '', to: '' };
  const [detailFilters, setDetailFilters] = useState({ paid: EMPTY_DF, receivable: EMPTY_DF });
  const [detailPageSize, setDetailPageSize] = useState(10);
  const [histPage, setHistPage] = useState(1);
  const EMPTY_HF = { q: '', status: '', from: '', to: '' };
  const [histFilter, setHistFilter] = useState(EMPTY_HF);
  const [histPageSize, setHistPageSize] = useState(10);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem('closing-panel-collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next);
    try { window.localStorage.setItem('closing-panel-collapsed', next ? '1' : '0'); } catch { /* abaikan */ }
  };

  // Dialog Closing
  const [closeOpen, setCloseOpen] = useState(false);
  const [upTo, setUpTo] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [preview, setPreview] = useState<Pending | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [closing, setClosing] = useState(false);

  // Dialog Buka Ulang
  const [reopenTarget, setReopenTarget] = useState<ClosingItem | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);

  // Status transfer closing: rincian tautan (baris yang dibuka), dialog "Catat transfer", dan lepas tautan.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settleTarget, setSettleTarget] = useState<ClosingItem | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const unlinkSettlement = async (c: ClosingItem, s: ClosingItem['settlements'][number]) => {
    if (unlinkingId) return;
    if (!await confirm({
      message: `Lepas tautan transfer ${s.fromWalletName} → ${s.toWalletName} sebesar ${formatRp(s.amount)} dari closing ini? Transfer dompetnya tetap ada; hanya statusnya yang kembali berkurang.`,
      danger: true,
    })) return;
    setUnlinkingId(s.id);
    try {
      const res = await fetch(`/api/closings/${c.id}/settlements?settlementId=${encodeURIComponent(s.id)}`, { method: 'DELETE', headers });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal melepas tautan.'); return; }
      toast.success('Tautan dilepas.');
      await load();
    } catch (err) {
      console.error('Gagal melepas tautan transfer', err);
      toast.error('Gagal melepas tautan.');
    } finally { setUnlinkingId(null); }
  };

  // Unduh PDF (closing resmi / draf) dari API — rute butuh header auth, jadi diambil sebagai blob lalu diunduh.
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const downloadPdf = async (key: string, url: string, filename: string) => {
    if (pdfBusy) return;
    setPdfBusy(key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        toast.error(data.error ?? 'Gagal membuat PDF.');
        return;
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Gagal mengunduh PDF closing', err);
      toast.error('Gagal membuat PDF.');
    } finally { clearTimeout(timer); setPdfBusy(null); }
  };
  // Kirim WA ke nomor toko (minta HPP ditransfer). Pesan + tautan PDF publik dibuat server; pengguna menekan Kirim di WA.
  const [waBusyId, setWaBusyId] = useState<string | null>(null);
  const sendClosingWhatsApp = async (id: string) => {
    if (waBusyId) return;
    // Jendela dibuka SEKARANG (sebelum await) supaya tidak diblokir popup-blocker, lalu diarahkan.
    const win = window.open('', '_blank');
    setWaBusyId(id);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(`/api/closings/${id}/wa`, { method: 'POST', headers, signal: ctrl.signal });
      const data = await res.json().catch(() => ({})) as { error?: string; phone?: string; message?: string };
      if (!res.ok || !data.phone || !data.message) { win?.close(); toast.error(data.error ?? 'Gagal menyiapkan pesan WhatsApp.'); return; }
      const waUrl = `https://wa.me/${normalizePhone(data.phone)}?text=${encodeURIComponent(data.message)}`;
      if (win) win.location.href = waUrl; else window.location.assign(waUrl);
    } catch (err) {
      console.error('Gagal menyiapkan WA closing', err);
      win?.close();
      toast.error('Gagal menyiapkan pesan WhatsApp.');
    } finally { clearTimeout(timer); setWaBusyId(null); }
  };
  const pdfIcon = (key: string) => pdfBusy === key ? <Loader2 size={12} className="animate-spin" /> : <PdfIcon size={15} />;

  const loadIdRef = useRef(0);
  const load = useCallback(async () => {
    const myId = ++loadIdRef.current;
    setLoading(true);
    try {
      const [pRes, hRes] = await Promise.all([
        fetch('/api/closings/pending', { headers }),
        fetch('/api/closings', { headers }),
      ]);
      if (myId !== loadIdRef.current) return;
      if (pRes.ok) setPending(await pRes.json() as Pending);
      if (hRes.ok) {
        const h = await hRes.json() as { closings: ClosingItem[]; latestActiveId: string | null };
        setClosings(h.closings);
        setLatestActiveId(h.latestActiveId);
      }
    } catch (err) {
      console.error('Gagal memuat data closing', err);
    } finally { if (myId === loadIdRef.current) setLoading(false); }
  }, [creds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]); // memuat data saat panel dibuka (pola sama dengan tab laporan lain)

  // Pratinjau closing: abaikan respons lama bila tanggal sudah diganti lagi.
  const previewIdRef = useRef(0);
  useEffect(() => {
    if (!closeOpen || !upTo) return;
    const myId = ++previewIdRef.current;
    // Kosongkan pratinjau lama dulu: angka basi tidak boleh tampil (atau dipakai) bila fetch baru gagal.
    /* eslint-disable react-hooks/set-state-in-effect -- reset pratinjau saat tanggal berubah, lalu muat ulang */
    setPreview(null);
    setPreviewError(false);
    setPreviewLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch(`/api/closings/pending?upTo=${upTo}`, { headers })
      .then(async r => {
        if (myId !== previewIdRef.current) return;
        if (!r.ok) { setPreviewError(true); return; }
        const data = await r.json() as Pending;
        if (myId === previewIdRef.current) setPreview(data);
      })
      .catch(err => { console.error('Gagal memuat pratinjau closing', err); if (myId === previewIdRef.current) setPreviewError(true); })
      .finally(() => { if (myId === previewIdRef.current) setPreviewLoading(false); });
  }, [closeOpen, upTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const openClose = () => {
    setUpTo(pending?.today ?? '');
    setCloseNote('');
    setPreview(null);
    setPreviewError(false);
    setCloseOpen(true);
  };

  const submitClose = async () => {
    if (closing) return;
    setClosing(true);
    try {
      const res = await fetch('/api/closings', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ upTo, note: closeNote }) });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal melakukan closing.'); return; }
      toast.success('Closing berhasil.');
      setCloseOpen(false);
      await load();
      onChanged();
    } catch {
      toast.error('Gagal melakukan closing.');
    } finally { setClosing(false); }
  };

  const submitReopen = async () => {
    if (!reopenTarget || reopening || !reopenReason.trim()) return;
    setReopening(true);
    try {
      const res = await fetch(`/api/closings/${reopenTarget.id}/reopen`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reopenReason }) });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal membuka ulang closing.'); return; }
      toast.success('Closing dibuka ulang.');
      setReopenTarget(null);
      await load();
      onChanged();
    } catch {
      toast.error('Gagal membuka ulang closing.');
    } finally { setReopening(false); }
  };

  const detail = pending ? (detailTab === 'paid' ? pending.paid : pending.receivable) : null;

  // Paginasi (client-side) untuk tabel rincian & riwayat.
  const paginate = <T,>(items: T[], page: number, size: number) => {
    const totalPages = size === Infinity ? 1 : Math.max(1, Math.ceil(items.length / size));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const rows = size === Infinity ? items : items.slice((safePage - 1) * size, safePage * size);
    return { rows, totalPages, safePage, offset: size === Infinity ? 0 : (safePage - 1) * size };
  };
  const df = detailFilters[detailTab];
  const setDf = (patch: Partial<typeof EMPTY_DF>) => { setDetailFilters(f => ({ ...f, [detailTab]: { ...f[detailTab], ...patch } })); setDetailPage(1); };
  // Tab "Sudah dibayar" disaring menurut tanggal bayar, "Belum dibayar" menurut tanggal transaksi (belum ada tgl bayar).
  const filteredLines = (detail?.lines ?? []).filter(l => {
    const q = df.q.trim().toLowerCase();
    if (q && !`${l.invoiceNo} ${l.party} ${l.note ?? ''}`.toLowerCase().includes(q)) return false;
    const d = detailTab === 'paid' ? (l.paidDate ?? l.txDate) : l.txDate;
    return (!df.from || d >= df.from) && (!df.to || d <= df.to);
  });
  const filterActive = !!(df.q || df.from || df.to);
  const dPg = paginate(filteredLines, detailPage, detailPageSize);
  const setHf = (patch: Partial<typeof EMPTY_HF>) => { setHistFilter(f => ({ ...f, ...patch })); setHistPage(1); };
  const hq = histFilter.q.trim().toLowerCase();
  const filteredClosings = closings.filter(c => {
    if (hq && !`${c.closedBy} ${c.note}`.toLowerCase().includes(hq)) return false;
    const st = histFilter.status;
    if (st === 'dibuka_ulang' ? c.status !== 'dibuka_ulang'
      : st === 'saldo_awal' ? !c.isOpeningBalance
      : st ? c.status !== 'aktif' || c.settlementStatus !== st : false) return false;
    return (!histFilter.from || c.periodTo >= histFilter.from) && (!histFilter.to || c.periodTo <= histFilter.to);
  });
  const histFilterActive = !!(histFilter.q || histFilter.status || histFilter.from || histFilter.to);
  const hPg = paginate(filteredClosings, histPage, histPageSize);
  const closable = preview?.paid.closable;
  const cell = 'px-3 py-2 whitespace-nowrap';
  const th = 'px-3 py-2.5 font-bold uppercase tracking-wide whitespace-nowrap';
  const thStyle = { color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' } as const;

  // Potongan tampilan riwayat yang dipakai bersama oleh kartu (mobile) dan tabel (md ke atas).
  const iconBtn = 'btn-ghost inline-flex items-center justify-center align-middle h-10 w-10 md:h-[30px] md:w-[30px]';
  const periodLabel = (c: ClosingItem) => c.periodFrom && c.periodFrom !== c.periodTo ? `${fmtDay(c.periodFrom)} – ${fmtDay(c.periodTo)}` : fmtDay(c.periodTo);
  const statusBadges = (c: ClosingItem) => (
    <>
      {c.status === 'aktif'
        ? <span className="badge badge-green">Aktif</span>
        : (
          <Tooltip label={`${c.reopenedBy ? `Oleh ${c.reopenedBy} · ` : ''}${c.reopenedAt ? fmtStamp(c.reopenedAt) : ''}${c.reopenReason ? ` — ${c.reopenReason}` : ''}`}>
            <span className="badge badge-gray">Dibuka ulang</span>
          </Tooltip>
        )}
      {c.settlementStatus && (
        <Tooltip label={c.settlements.length > 0 ? 'Lihat transfer tertaut' : 'Belum ada transfer tertaut'}>
          <button type="button" aria-expanded={expandedId === c.id} onClick={() => setExpandedId(v => v === c.id ? null : c.id)}
            className={`badge ${SETTLE_BADGE[c.settlementStatus]} min-h-8 md:min-h-0`} style={{ cursor: 'pointer' }}>
            {SETTLEMENT_STATUS_LABEL[c.settlementStatus]}
          </button>
        </Tooltip>
      )}
    </>
  );
  const rowActions = (c: ClosingItem, canReopen: boolean) => (
    <>
      {canWallet('create') && c.settlementStatus && c.settlementStatus !== 'sudah' && (
        <Tooltip label="Catat transfer">
          <button aria-label="Catat transfer" onClick={() => setSettleTarget(c)} className={iconBtn} style={{ padding: 0, color: 'var(--accent)' }}>
            <ArrowRightLeft size={14} />
          </button>
        </Tooltip>
      )}
      {can('close') && c.status === 'aktif' && !c.isOpeningBalance && (
        <Tooltip label="Kirim WA">
          <button aria-label="Kirim WA" onClick={() => sendClosingWhatsApp(c.id)} disabled={!!waBusyId} className={iconBtn} style={{ padding: 0, color: '#059669' }}>
            {waBusyId === c.id ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={15} />}
          </button>
        </Tooltip>
      )}
      <Tooltip label="Unduh PDF closing">
        <button aria-label="Unduh PDF closing" onClick={() => downloadPdf(`c:${c.id}`, `/api/closings/${c.id}/pdf`, `closing-hpp-${c.periodTo}.pdf`)} disabled={!!pdfBusy} className={iconBtn} style={{ padding: 0 }}>
          {pdfIcon(`c:${c.id}`)}
        </button>
      </Tooltip>
      {canReopen && (
        <Tooltip label="Buka ulang closing">
          <button aria-label="Buka ulang closing" onClick={() => { setReopenTarget(c); setReopenReason(''); }} className={iconBtn} style={{ padding: 0 }}>
            <Unlock size={14} />
          </button>
        </Tooltip>
      )}
    </>
  );
  const settlementDetail = (c: ClosingItem) => (
    <>
      <p className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
        Tertransfer {formatRp(c.settledAmount)} dari HPP {formatRp(c.totalCogs ?? 0)}
        {c.settlementStatus !== 'sudah' && c.settlementRemaining != null ? ` · sisa ${formatRp(c.settlementRemaining)}` : ''}
      </p>
      {c.settlements.length === 0 ? (
        <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Belum ada transfer tertaut.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {c.settlements.map(st => (
            <li key={st.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 break-words" style={{ color: 'var(--text-primary)' }}>
                {fmtDay(st.date)} · {st.fromWalletName} → {st.toWalletName}
              </span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="font-semibold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(st.amount)}</span>
                {canWallet('edit') && (
                  <Tooltip label="Lepas tautan">
                    <button aria-label="Lepas tautan" onClick={() => unlinkSettlement(c, st)} disabled={!!unlinkingId}
                      className="btn-ghost inline-flex items-center justify-center h-10 w-10 md:h-6 md:w-6" style={{ padding: 0, color: 'var(--danger)' }}>
                      {unlinkingId === st.id ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
                    </button>
                  </Tooltip>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  const canReopenRow = (c: ClosingItem) => can('reopen') && c.status === 'aktif' && c.id === latestActiveId && (!c.isOpeningBalance || isSuperAdmin);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div
          className="flex items-center gap-2.5 cursor-pointer select-none min-w-0 flex-1 basis-56"
          role="button" tabIndex={0} aria-expanded={!collapsed}
          onClick={() => toggleCollapsed(!collapsed)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed(!collapsed); } }}
        >
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            <Lock size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Closing HPP</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {collapsed && pending
                ? `Belum closing: HPP ${formatRp(pending.paid.totals.cogs)} · piutang ${formatRp(pending.receivable.totals.cogs)}`
                : `${pending?.lastClosingTo ? `Closing terakhir sampai ${fmtDay(pending.lastClosingTo)}` : 'Belum ada closing aktif'} · tidak mengikuti filter periode`}
            </p>
          </div>
          <ChevronDown size={16} className="flex-shrink-0" style={{ color: 'var(--text-muted)', transform: collapsed ? undefined : 'rotate(180deg)', transition: 'transform 0.15s' }} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip label="Unduh draf PDF (belum closing)">
            <button aria-label="Unduh draf PDF" disabled={!pending || !!pdfBusy}
              onClick={() => pending && downloadPdf('draft', '/api/closings/pending/pdf', `draf-closing-hpp-${pending.today}.pdf`)}
              className="btn-ghost flex items-center justify-center h-10 w-10 sm:h-[28px] sm:w-[28px]" style={{ padding: 0 }}>
              {pdfBusy === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={18} />}
            </button>
          </Tooltip>
          {/* Aktif (berwarna) selama panel riwayat terbuka. Saat kartu terlipat, klik membuka kartu + riwayat. */}
          <button
            onClick={() => { if (collapsed) { toggleCollapsed(false); setShowHistory(true); } else setShowHistory(v => !v); }}
            aria-pressed={showHistory && !collapsed}
            className="btn-ghost flex items-center gap-1.5 h-10 sm:h-[28px]"
            style={showHistory && !collapsed
              ? { fontSize: 12, padding: '0 10px', background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 700 }
              : { fontSize: 12, padding: '0 10px' }}>
            <HistoryIcon size={14} /> Riwayat
          </button>
          {can('close') && (
            <button onClick={openClose} disabled={!pending || loading} className="btn-primary flex items-center gap-1.5 h-10 sm:h-[28px]" style={{ fontSize: 12, padding: '0 12px' }}>
              <Lock size={14} /> Closing
            </button>
          )}
        </div>
      </div>

      {!collapsed && (loading && !pending ? (
        <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}><Loader2 size={13} className="animate-spin" /> Memuat…</p>
      ) : pending && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl p-4" style={{ background: 'var(--accent-bg)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: 'var(--accent)' }}><Wallet size={12} /> Sudah dibayar, belum closing</p>
            <p className="text-lg font-extrabold tabular mt-1" style={{ color: 'var(--accent)' }}>HPP {formatRp(pending.paid.totals.cogs)}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {formatQty(pending.paid.totals.qty)} unit · {pending.paid.totals.count} transaksi · omzet {formatRp(pending.paid.totals.revenue)}
            </p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface-2)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}><Clock size={12} /> Belum dibayar (piutang)</p>
            <p className="text-lg font-extrabold tabular mt-1" style={{ color: 'var(--text-primary)' }}>HPP {formatRp(pending.receivable.totals.cogs)}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {formatQty(pending.receivable.totals.qty)} unit · {pending.receivable.totals.count} transaksi · tidak ikut closing sampai dibayar
            </p>
          </div>
        </div>
      ))}

      {!collapsed && pending && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button onClick={() => setShowDetail(v => !v)} className="text-xs font-semibold flex items-center gap-1 min-h-10 sm:min-h-0" style={{ color: 'var(--accent)' }}>
              <ChevronDown size={13} style={{ transform: showDetail ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
              {showDetail ? 'Sembunyikan rincian' : 'Lihat rincian untuk audit'}
            </button>
          </div>
          {showDetail && detail && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                {([['paid', 'Sudah dibayar'], ['receivable', 'Belum dibayar']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => { setDetailTab(id); setDetailPage(1); }} className="px-3 py-1.5 min-h-10 sm:min-h-0 rounded-xl text-xs font-bold flex-1 sm:flex-none"
                    style={detailTab === id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <input value={df.q} onChange={e => setDf({ q: e.target.value })} className="input flex-1 min-w-[160px] sm:!py-0 sm:!h-[30px] sm:!text-xs" placeholder="Cari invoice / pihak…" aria-label="Cari invoice atau pihak" />
                <div className="w-[130px]"><DateInput height={30} value={df.from} onChange={v => setDf({ from: v })} max={df.to || undefined} /></div>
                <span className="text-xs pb-1.5" style={{ color: 'var(--text-muted)' }}>s/d</span>
                <div className="w-[130px]"><DateInput height={30} value={df.to} onChange={v => setDf({ to: v })} min={df.from || undefined} /></div>
                {filterActive && (
                  <button onClick={() => setDf(EMPTY_DF)} className="btn-ghost text-xs font-semibold min-h-10 sm:min-h-0 px-2" style={{ color: 'var(--danger)' }}>Reset</button>
                )}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Tanggal disaring menurut {detailTab === 'paid' ? 'tanggal bayar' : 'tanggal transaksi'}.</p>
              {filteredLines.length === 0 ? (
                <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>{filterActive ? 'Tidak ada data yang cocok dengan filter.' : 'Tidak ada data.'}</p>
              ) : (
                <>
                <ul className="md:hidden rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-2)' }}>
                  {dPg.rows.map((l, i) => (
                    <li key={l.key} className="px-3 py-2.5 flex gap-2.5 text-xs" style={{ borderTop: i > 0 ? '1px solid var(--border-2)' : undefined }}>
                      <span className="tabular w-5 flex-shrink-0 text-right" style={{ color: 'var(--text-muted)' }}>{dPg.offset + i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold min-w-0 break-words" style={{ color: 'var(--text-primary)' }}>{l.invoiceNo || '–'}</p>
                          <p className="font-semibold tabular flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{formatRp(l.cogs)}</p>
                        </div>
                        <p className="break-words" style={{ color: 'var(--text-muted)' }}>{l.party}{l.note ? ` · ${l.note}` : ''}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                          Transaksi {fmtDay(l.txDate)} · Bayar {fmtDay(l.paidDate)} · {formatQty(l.qty)} unit
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden md:block overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                  <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <th className={`${th} text-left`} style={thStyle}>No</th>
                        <th className={`${th} text-left`} style={thStyle}>Invoice</th>
                        <th className={`${th} text-left`} style={thStyle}>Tgl Transaksi</th>
                        <th className={`${th} text-left`} style={thStyle}>Tgl Bayar</th>
                        <th className={`${th} text-right`} style={thStyle}>Qty</th>
                        <th className={`${th} text-right`} style={thStyle}>HPP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dPg.rows.map((l, i) => (
                        <tr key={l.key} style={{ borderBottom: '1px solid var(--border-2)' }}>
                          <td className={`${cell} tabular`} style={{ color: 'var(--text-muted)' }}>{dPg.offset + i + 1}</td>
                          <td className={cell} style={{ color: 'var(--text-primary)' }}>
                            <span className="font-semibold">{l.invoiceNo || '–'}</span>
                            <span className="ml-1.5" style={{ color: 'var(--text-muted)' }}>{l.party}{l.note ? ` · ${l.note}` : ''}</span>
                          </td>
                          <td className={cell} style={{ color: 'var(--text-secondary)' }}>{fmtDay(l.txDate)}</td>
                          <td className={cell} style={{ color: 'var(--text-secondary)' }}>{fmtDay(l.paidDate)}</td>
                          <td className={`${cell} text-right tabular`} style={{ color: 'var(--text-secondary)' }}>{formatQty(l.qty)}</td>
                          <td className={`${cell} text-right tabular font-semibold`} style={{ color: 'var(--text-primary)' }}>{formatRp(l.cogs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
              <Pagination total={filteredLines.length} safePage={dPg.safePage} totalPages={dPg.totalPages} pageSize={detailPageSize}
                onPageSize={n => { setDetailPageSize(n); setDetailPage(1); }} onGoPage={setDetailPage} unit="baris" />
              {(detail.lines.length > DETAIL_LIMIT || detail.truncated) && (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Menampilkan {Math.min(detail.lines.length, DETAIL_LIMIT)} baris pertama dari {detail.totals.count}; total di atas mencakup semuanya.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!collapsed && showHistory && (
        <div className="space-y-2">
          <p className="field-label">Riwayat closing</p>
          <div className="flex flex-wrap items-end gap-2">
            <input value={histFilter.q} onChange={e => setHf({ q: e.target.value })} className="input flex-1 min-w-[160px] sm:!py-0 sm:!h-[30px] sm:!text-xs" placeholder="Cari penutup / catatan…" aria-label="Cari penutup atau catatan" />
            <select value={histFilter.status} onChange={e => setHf({ status: e.target.value })} aria-label="Filter status" className="input sm:!py-0 sm:!h-[30px] sm:!text-xs" style={{ width: 150 }}>
              <option value="">Semua status</option>
              <option value="belum">Belum ditransfer</option>
              <option value="sebagian">Sebagian</option>
              <option value="sudah">Sudah ditransfer</option>
              <option value="dibuka_ulang">Dibuka ulang</option>
              <option value="saldo_awal">Saldo awal</option>
            </select>
            <div className="w-[130px]"><DateInput height={30} value={histFilter.from} onChange={v => setHf({ from: v })} max={histFilter.to || undefined} /></div>
            <span className="text-xs pb-1.5" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <div className="w-[130px]"><DateInput height={30} value={histFilter.to} onChange={v => setHf({ to: v })} min={histFilter.from || undefined} /></div>
            {histFilterActive && (
              <button onClick={() => setHf(EMPTY_HF)} className="btn-ghost text-xs font-semibold min-h-10 sm:min-h-0 px-2" style={{ color: 'var(--danger)' }}>Reset</button>
            )}
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Tanggal disaring menurut akhir periode closing.</p>
          {filteredClosings.length === 0 ? (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>{closings.length === 0 ? 'Belum ada closing.' : 'Tidak ada closing yang cocok dengan filter.'}</p>
          ) : (
            <>
            <ul className="md:hidden rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-2)' }}>
              {hPg.rows.map((c, i) => (
                <li key={c.id} className="px-3 py-3 text-xs" style={{ borderTop: i > 0 ? '1px solid var(--border-2)' : undefined }}>
                  <div className="flex items-start gap-2.5">
                    <span className="tabular w-5 flex-shrink-0 text-right" style={{ color: 'var(--text-muted)' }}>{hPg.offset + i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold min-w-0" style={{ color: 'var(--text-primary)' }}>
                          {periodLabel(c)}
                          {c.isOpeningBalance && <span className="badge badge-blue ml-1.5" style={{ fontSize: 10 }}>Saldo awal</span>}
                        </p>
                        <div className="text-right tabular flex-shrink-0">
                          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.totalCogs == null ? '–' : formatRp(c.totalCogs)}</p>
                          <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>{c.totalRevenue == null ? '–' : formatRp(c.totalRevenue)}</p>
                        </div>
                      </div>
                      <p className="text-[10.5px] mt-0.5 break-words" style={{ color: 'var(--text-muted)' }}>
                        {c.itemCount} transaksi · {fmtStamp(c.closedAt)} · {c.closedBy || '–'}
                      </p>
                      {c.note && <p className="text-[10.5px] break-words" style={{ color: 'var(--text-muted)' }}>{c.note}</p>}
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-2">
                        <div className="flex flex-wrap items-center gap-1.5">{statusBadges(c)}</div>
                        <div className="flex flex-wrap items-center justify-end gap-1">{rowActions(c, canReopenRow(c))}</div>
                      </div>
                    </div>
                  </div>
                  {expandedId === c.id && c.settlementStatus && (
                    <div className="mt-2 rounded-lg px-3 py-2.5" style={{ background: 'var(--surface-2)' }}>{settlementDetail(c)}</div>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <th className={`${th} text-left`} style={thStyle}>No</th>
                    <th className={`${th} text-left`} style={thStyle}>Periode</th>
                    <th className={`${th} text-right`} style={thStyle}>HPP / Omzet</th>
                    <th className={`${th} text-left`} style={thStyle}>Status</th>
                    <th className={th} style={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {hPg.rows.map((c, i) => (
                    <Fragment key={c.id}>
                      <tr style={{ borderBottom: expandedId === c.id ? undefined : '1px solid var(--border-2)' }}>
                        <td className="px-3 py-2.5 align-top tabular" style={{ color: 'var(--text-muted)' }}>{hPg.offset + i + 1}</td>
                        <td className="px-3 py-2.5 align-top" style={{ color: 'var(--text-primary)' }}>
                          <span className="font-semibold">{periodLabel(c)}</span>
                          {c.isOpeningBalance && <span className="badge badge-blue ml-1.5" style={{ fontSize: 10 }}>Saldo awal</span>}
                          <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {c.itemCount} transaksi · {fmtStamp(c.closedAt)} · {c.closedBy || '–'}
                          </p>
                          {c.note && <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>{c.note}</p>}
                        </td>
                        <td className="px-3 py-2.5 align-top text-right tabular whitespace-nowrap">
                          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.totalCogs == null ? '–' : formatRp(c.totalCogs)}</p>
                          <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>{c.totalRevenue == null ? '–' : formatRp(c.totalRevenue)}</p>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex flex-col items-start gap-1">{statusBadges(c)}</div>
                        </td>
                        <td className="px-3 py-2.5 align-top text-right">
                          <div className="flex flex-wrap justify-end gap-1">{rowActions(c, canReopenRow(c))}</div>
                        </td>
                      </tr>
                      {expandedId === c.id && c.settlementStatus && (
                        <tr style={{ borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                          <td colSpan={5} className="px-3 py-2.5">{settlementDetail(c)}</td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
          <Pagination total={filteredClosings.length} safePage={hPg.safePage} totalPages={hPg.totalPages} pageSize={histPageSize}
            onPageSize={n => { setHistPageSize(n); setHistPage(1); }} onGoPage={setHistPage} unit="closing" />
        </div>
      )}

      {closeOpen && (
        <Modal onClose={() => !closing && setCloseOpen(false)} className="modal-sm">
          <div className="modal-accent" />
          <span className="modal-handle" />
          <div className="modal-header">
            <div className="modal-header-left">
              <div className="modal-icon"><Lock size={17} /></div>
              <div>
                <p className="modal-title">Closing HPP</p>
                <p className="modal-subtitle">Semua yang sudah dibayar &amp; belum closing sampai tanggal dipilih</p>
              </div>
            </div>
            <Tooltip label="Tutup"><button onClick={() => !closing && setCloseOpen(false)} className="modal-close" aria-label="Tutup"><X size={14} /></button></Tooltip>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Closing sampai tanggal bayar">
              <DateInput value={upTo} onChange={setUpTo} max={pending?.today} min={pending?.lastClosingTo ?? undefined} clearable={false} />
            </Field>
            <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
              {previewError ? (
                <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>Gagal menghitung pratinjau. Ganti tanggal atau coba lagi.</p>
              ) : previewLoading || !closable ? (
                <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}><Loader2 size={13} className="animate-spin" /> Menghitung…</p>
              ) : (
                <>
                  <p className="text-sm font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>HPP {formatRp(closable.cogs)}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {formatQty(closable.qty)} unit · {closable.count} transaksi · omzet {formatRp(closable.revenue)}
                  </p>
                  {closable.count === 0 && <p className="text-[11px] mt-1 font-semibold" style={{ color: 'var(--danger)' }}>Tidak ada yang bisa di-closing sampai tanggal ini.</p>}
                </>
              )}
            </div>
            <button type="button" onClick={() => downloadPdf('draft-dialog', `/api/closings/pending/pdf?upTo=${upTo}`, `draf-closing-hpp-${upTo}.pdf`)} disabled={!!pdfBusy || !upTo}
              className="btn-ghost flex items-center gap-1.5 self-start h-10 sm:h-[30px]" style={{ fontSize: 11 }}>
              {pdfIcon('draft-dialog')} Unduh draf PDF
            </button>
            <Field label="Catatan (opsional)">
              <textarea rows={3} value={closeNote} onChange={e => setCloseNote(e.target.value.slice(0, 500))} className="input" style={{ resize: 'vertical' }} placeholder="Mis. Closing harian 12 Nov" />
            </Field>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Pesanan, pembayaran, dan rekap yang ikut closing terkunci (nilai, status, tanggal) sampai closing dibuka ulang.
            </p>
          </div>
          <div className="modal-footer">
            <button onClick={() => setCloseOpen(false)} disabled={closing} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
            <button onClick={submitClose} disabled={closing || previewLoading || previewError || !closable || closable.count === 0 || !upTo} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
              {closing ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              Closing Sekarang
            </button>
          </div>
        </Modal>
      )}

      {settleTarget && settleTarget.totalCogs != null && (
        <ClosingSettlementDialog
          creds={creds} onClose={() => setSettleTarget(null)} onDone={load}
          closing={{ id: settleTarget.id, periodFrom: settleTarget.periodFrom, periodTo: settleTarget.periodTo, totalCogs: settleTarget.totalCogs, settlementRemaining: settleTarget.settlementRemaining ?? settleTarget.totalCogs }}
        />
      )}

      {reopenTarget && (
        <Modal onClose={() => !reopening && setReopenTarget(null)} className="modal-sm">
          <div className="modal-accent" style={{ background: 'var(--danger)' }} />
          <span className="modal-handle" />
          <div className="modal-header">
            <div className="modal-header-left">
              <div className="modal-icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><Unlock size={17} /></div>
              <div>
                <p className="modal-title">Buka Ulang Closing</p>
                <p className="modal-subtitle">Sampai {fmtDay(reopenTarget.periodTo)} · {reopenTarget.itemCount} transaksi</p>
              </div>
            </div>
            <Tooltip label="Tutup"><button onClick={() => !reopening && setReopenTarget(null)} className="modal-close" aria-label="Tutup"><X size={14} /></button></Tooltip>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Semua transaksi di closing ini kembali berstatus &ldquo;belum closing&rdquo; dan bisa diedit lagi. Baris closing dan nominalnya tetap tersimpan sebagai riwayat.
            </p>
            <Field label="Alasan" required>
              <textarea rows={3} value={reopenReason} onChange={e => setReopenReason(e.target.value.slice(0, 500))} className="input" style={{ resize: 'vertical' }} placeholder="Mis. Salah input qty pesanan INV-123" />
            </Field>
          </div>
          <div className="modal-footer">
            <button onClick={() => setReopenTarget(null)} disabled={reopening} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
            <button onClick={submitReopen} disabled={reopening || !reopenReason.trim()} className="btn-danger" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
              {reopening ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
              Buka Ulang
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
