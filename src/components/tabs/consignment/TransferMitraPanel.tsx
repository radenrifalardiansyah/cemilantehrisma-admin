'use client';

// Sub-tab Mitra > Transfer Mitra: memindahkan stok titip dari mitra A ke mitra B (tanpa lewat gudang).
// Dokumen: draft -> approved | ditolak; approved -> dibatalkan (soft cancel). Efek stok hanya saat approve (server).
// API: /api/consignment/transfers (lihat kontrak di tugas); panel ini mandiri (fetch, polling, modal, bulk bar).

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowRightLeft, Ban, Check, CircleCheck, CircleX, Loader2, Pencil, Plus, Search, Store, Trash2, X,
} from 'lucide-react';
import Pagination from '@/components/Pagination';
import SearchSelect from '@/components/SearchSelect';
import DateTimeInput from '@/components/DateTimeInput';
import FilterSelect from '@/components/FilterSelect';
import ViewToggle from '@/components/ViewToggle';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import EmptyAddCard from '@/components/EmptyAddCard';
import Field from '@/components/Field';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { useViewMode } from '@/lib/useViewMode';
import { useVisiblePolling } from '@/lib/useVisiblePolling';
import { HEADER_BTN_H } from '@/lib/ui-constants';
import { formatRp } from '@/lib/format';
import type { Action } from '@/types/rbac';

const POLL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 30_000;
const BASE = '/api/consignment/transfers';

export interface TransferLocation { id: string; name: string; code?: string; logoUrl?: string; isActive?: boolean }
interface StockItem { productId: string; productName: string; stockQty: number; hargaTitip: number }

type TransferStatus = 'draft' | 'approved' | 'ditolak' | 'dibatalkan';
interface Sec { seconds: number }
interface Transfer {
  id: string; docNumber: string;
  fromLocationId: string; fromLocationName: string; toLocationId: string; toLocationName: string;
  items: { productId: string; productName: string; qty: number; hargaTitip: number }[];
  note: string | null; docDate?: Sec;
  status: TransferStatus;
  createdBy?: string | null; approvedBy?: string | null; approvedAt?: Sec | null;
  rejectedBy?: string | null; rejectedAt?: Sec | null; rejectReason?: string | null;
  cancelledBy?: string | null; cancelledAt?: Sec | null;
  createdAt?: Sec; updatedAt?: unknown;
}

const STATUS_LABEL: Record<TransferStatus, string> = { draft: 'Draft', approved: 'Approved', ditolak: 'Ditolak', dibatalkan: 'Dibatalkan' };
const STATUS_BADGE: Record<TransferStatus, string> = { draft: 'badge-amber', approved: 'badge-green', ditolak: 'badge-red', dibatalkan: 'badge-gray' };

const canDeleteStatus = (s: TransferStatus) => s === 'draft' || s === 'ditolak' || s === 'dibatalkan';

function formatDate(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function toLocalDateTimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const totalQty = (t: Transfer) => t.items.reduce((s, it) => s + it.qty, 0);

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

function Checkbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button" aria-label={label} aria-pressed={checked}
      onClick={e => { e.stopPropagation(); onChange(); }}
      className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors"
      style={{
        background: checked || indeterminate ? 'var(--accent)' : 'transparent',
        borderColor: checked || indeterminate ? 'var(--accent)' : 'var(--border)',
      }}
    >
      {indeterminate && !checked
        ? <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />
        : checked ? <Check size={11} color="#fff" strokeWidth={3} /> : null}
    </button>
  );
}

function MitraLogo({ location, size }: { location: { name: string; logoUrl?: string }; size: number }) {
  if (location.logoUrl) {
    return (
      <div className="rounded-xl overflow-hidden flex-shrink-0" style={{ width: size, height: size, background: 'var(--surface)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={location.logoUrl} alt={location.name} className="w-full h-full" style={{ objectFit: 'contain' }} />
      </div>
    );
  }
  return (
    <div className="rounded-xl flex-shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
      <Store size={Math.round(size * 0.45)} />
    </div>
  );
}

interface FormRow { productId: string; qty: string }
const EMPTY_ROW: FormRow = { productId: '', qty: '' };
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };

export default function TransferMitraPanel({ creds, can, locations, locationStock, onStockChanged, preset, onPresetHandled, highlightId, onHighlightHandled, active = true }: {
  creds: string;
  can: (a: Action) => boolean;
  locations: TransferLocation[];
  /** Stok per mitra (sudah dimuat ConsignmentTab) — dipakai untuk menampilkan jumlah stok di pilihan Mitra Asal. */
  locationStock: Record<string, { stockQty: number }[]>;
  /** Dipanggil setelah aksi yang mengubah stok mitra (approve/batalkan) supaya tab Lokasi ikut segar. */
  onStockChanged: () => void | Promise<void>;
  /** Tombol cepat dari tab Lokasi: buka form dengan Mitra Asal terisi. `n` berubah tiap klik. */
  preset?: { locationId: string; n: number } | null;
  onPresetHandled?: () => void;
  /** Dari klik "Lihat" notifikasi: sorot dan gulir ke dokumen ini setelah daftar dimuat. */
  highlightId?: string | null;
  onHighlightHandled?: () => void;
  /** false = sub-tab Transfer Mitra tidak sedang dibuka: daftar/bulk bar disembunyikan dan tidak ada polling, tetapi form (modal) tetap bisa dibuka, mis. dari tombol cepat di tab Lokasi. */
  active?: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useViewMode('consignment-transfers', 'table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'semua' | TransferStatus>('semua');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<'approve' | 'delete' | null>(null);

  // fetch ber-timeout; error jaringan/timeout dikembalikan sebagai { ok:false } (tidak dilempar).
  const api = async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: init?.method ?? 'GET', signal: ctrl.signal,
        headers: { 'x-admin-auth': creds, ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const data = await r.json().catch(() => ({})) as T & { error?: string };
      if (!r.ok) return { ok: false, error: data.error ?? `Permintaan gagal (${r.status}).` };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: (e as Error).name === 'AbortError' ? 'Permintaan terlalu lama — coba lagi.' : 'Koneksi bermasalah — periksa koneksi internet.' };
    } finally {
      clearTimeout(timer);
    }
  };

  const loadSeq = useRef(0);
  const load = async () => {
    const seq = ++loadSeq.current;
    const res = await api<{ transfers: Transfer[] }>('');
    if (seq !== loadSeq.current) return; // respons lama diabaikan
    if (res.ok) {
      setTransfers(res.data.transfers ?? []);
      setSelected(prev => {
        const ids = new Set((res.data.transfers ?? []).map(t => t.id));
        const next = new Set([...prev].filter(id => ids.has(id)));
        return next.size === prev.size ? prev : next;
      });
    }
    // gagal: biarkan data lama; polling berikutnya mencoba lagi
    setLoading(false);
  };
  useVisiblePolling(() => { if (active) void load(); }, POLL_MS, [active]);

  // ── Filter + paging ─────────────────────────────────────────
  const filtered = transfers.filter(t => {
    if (statusFilter !== 'semua' && t.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.docNumber.toLowerCase().includes(q)
      || t.fromLocationName.toLowerCase().includes(q) || t.toLocationName.toLowerCase().includes(q)
      || t.items.some(it => it.productName.toLowerCase().includes(q));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Sorot dokumen dari notifikasi: reset filter, buka halamannya, gulir, lalu sorot 2,5 detik.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [flashId, setFlashId] = useState<string | null>(null);
  // Efek ini sengaja memicu state sebagai respons notifikasi dari induk (sama seperti sorot kiriman/rekap di ConsignmentTab).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!highlightId || transfers.length === 0) return;
    const idx = transfers.findIndex(t => t.id === highlightId);
    if (idx === -1) { onHighlightHandled?.(); return; }
    setStatusFilter('semua'); setSearch('');
    setPage(Math.floor(idx / pageSize) + 1);
    setFlashId(highlightId);
    requestAnimationFrame(() => rowRefs.current[highlightId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    onHighlightHandled?.();
    const timer = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightId, transfers]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPageSelected = paginated.length > 0 && paginated.every(t => selected.has(t.id));
  const somePageSelected = paginated.some(t => selected.has(t.id));
  const togglePageAll = () => setSelected(s => {
    const n = new Set(s);
    if (allPageSelected) paginated.forEach(t => n.delete(t.id)); else paginated.forEach(t => n.add(t.id));
    return n;
  });

  // ── Aksi per dokumen ────────────────────────────────────────
  const approveOne = async (t: Transfer) => {
    if (!await confirm({ title: 'Approve Transfer', message: `Approve ${t.docNumber}? Stok ${totalQty(t)} pcs berpindah dari "${t.fromLocationName}" ke "${t.toLocationName}".` })) return;
    setBusyId(t.id);
    try {
      const res = await api(`/${t.id}/approve`, { method: 'POST', body: {} });
      if (res.ok) toast.success(`${t.docNumber} di-approve; stok berpindah.`);
      else toast.error(res.error);
      await Promise.all([load(), onStockChanged()]);
    } finally { setBusyId(null); }
  };

  const [rejectTarget, setRejectTarget] = useState<Transfer | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const submitReject = async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const reason = rejectReason.trim();
      const res = await api(`/${rejectTarget.id}/reject`, { method: 'POST', body: reason ? { reason } : {} });
      if (res.ok) { toast.success(`${rejectTarget.docNumber} ditolak.`); setRejectTarget(null); setRejectReason(''); }
      else toast.error(res.error);
      await load();
    } finally { setRejecting(false); }
  };

  const cancelOne = async (t: Transfer) => {
    if (!await confirm({ title: 'Batalkan Transfer', message: `Batalkan ${t.docNumber}? Stok ${totalQty(t)} pcs dikembalikan ke "${t.fromLocationName}" dan dikurangi dari "${t.toLocationName}".`, confirmLabel: 'Batalkan Transfer', danger: true })) return;
    setBusyId(t.id);
    try {
      const res = await api(`/${t.id}/cancel`, { method: 'POST', body: {} });
      if (res.ok) toast.success(`${t.docNumber} dibatalkan; stok dikembalikan ke mitra asal.`);
      else toast.error(res.error);
      await Promise.all([load(), onStockChanged()]);
    } finally { setBusyId(null); }
  };

  const deleteOne = async (t: Transfer) => {
    if (!await confirm({ message: `Hapus ${t.docNumber}? ${t.status === 'draft' ? 'Draft ini belum mengubah stok.' : 'Dokumen ini tidak lagi berefek ke stok.'}`, danger: true })) return;
    setBusyId(t.id);
    try {
      const res = await api(`/${t.id}`, { method: 'DELETE' });
      if (res.ok) {
        setTransfers(prev => prev.filter(x => x.id !== t.id));
        setSelected(sel => { const n = new Set(sel); n.delete(t.id); return n; });
        toast.success(`${t.docNumber} dihapus.`);
      } else toast.error(res.error);
    } finally { setBusyId(null); }
  };

  // Bulk: satu per satu berurutan (tiap approve memvalidasi stok terkini), hasil dirangkum.
  const bulkApprove = async () => {
    const drafts = transfers.filter(t => selected.has(t.id) && t.status === 'draft');
    if (drafts.length === 0) { toast.error('Tidak ada draft pada pilihan.'); return; }
    if (!await confirm({ title: 'Approve massal', message: `Approve ${drafts.length} draft transfer? Diproses berurutan; yang stok mitra asalnya kurang akan gagal dan dilewati.` })) return;
    setBulkBusy('approve');
    let ok = 0;
    const failed: { label: string; reason: string }[] = [];
    try {
      for (const d of drafts) {
        const res = await api(`/${d.id}/approve`, { method: 'POST', body: {} });
        if (res.ok) ok++; else failed.push({ label: d.docNumber, reason: res.error });
      }
      if (ok > 0) toast.success(`${ok} transfer di-approve.`);
      if (failed.length > 0) toast.error(`${failed.length} gagal: ` + failed.slice(0, 3).map(f => `${f.label} (${f.reason})`).join(' • ') + (failed.length > 3 ? ` (+${failed.length - 3} lainnya)` : ''));
      setSelected(new Set());
      await Promise.all([load(), onStockChanged()]);
    } finally { setBulkBusy(null); }
  };

  const bulkDelete = async () => {
    const deletable = transfers.filter(t => selected.has(t.id) && canDeleteStatus(t.status));
    if (deletable.length === 0) { toast.error('Tidak ada dokumen yang boleh dihapus pada pilihan (approved harus dibatalkan dulu).'); return; }
    const skipped = selected.size - deletable.length;
    if (!await confirm({ message: `Hapus ${deletable.length} dokumen transfer?${skipped > 0 ? ` ${skipped} lainnya dilewati karena tidak boleh dihapus.` : ''}`, danger: true })) return;
    setBulkBusy('delete');
    let ok = 0;
    const failed: { label: string; reason: string }[] = [];
    try {
      for (const d of deletable) {
        const res = await api(`/${d.id}`, { method: 'DELETE' });
        if (res.ok) ok++; else failed.push({ label: d.docNumber, reason: res.error });
      }
      if (ok > 0) toast.success(`${ok} dokumen dihapus.`);
      if (failed.length > 0) toast.error(`${failed.length} gagal: ` + failed.slice(0, 3).map(f => `${f.label} (${f.reason})`).join(' • '));
      setSelected(new Set());
      await load();
    } finally { setBulkBusy(null); }
  };

  // ── Form ────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Transfer | null>(null);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [date, setDate] = useState(() => toLocalDateTimeInput(new Date()));
  const [rows, setRows] = useState<FormRow[]>([{ ...EMPTY_ROW }]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  // Stok mitra asal untuk baris produk; dipanggil dari handler (buka form / ganti asal). Respons lama
  // (asal sudah diganti) diabaikan lewat nomor urut.
  const stockSeq = useRef(0);
  const loadStock = async (locationId: string) => {
    const seq = ++stockSeq.current;
    if (!locationId) { setStock([]); setStockLoading(false); return; }
    setStockLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const r = await fetch(`/api/consignment/locations/${locationId}/stock`, { headers: { 'x-admin-auth': creds }, signal: ctrl.signal });
      const list = r.ok ? (await r.json() as { stock: StockItem[] }).stock : [];
      if (seq === stockSeq.current) setStock(list);
    } catch {
      if (seq === stockSeq.current) { setStock([]); toast.error('Gagal memuat stok mitra asal.'); }
    } finally {
      clearTimeout(timer);
      if (seq === stockSeq.current) setStockLoading(false);
    }
  };

  const openCreate = (presetFrom?: string) => {
    setEditing(null); setFromId(presetFrom ?? ''); setToId(''); setRows([{ ...EMPTY_ROW }]); setNote('');
    setDate(toLocalDateTimeInput(new Date()));
    setShowForm(true);
    void loadStock(presetFrom ?? '');
  };
  const openEdit = (t: Transfer) => {
    setEditing(t); setFromId(t.fromLocationId); setToId(t.toLocationId);
    setRows(t.items.map(it => ({ productId: it.productId, qty: String(it.qty) })));
    setNote(t.note ?? '');
    setDate(t.docDate?.seconds ? toLocalDateTimeInput(new Date(t.docDate.seconds * 1000)) : toLocalDateTimeInput(new Date()));
    setShowForm(true);
    void loadStock(t.fromLocationId);
  };

  // Tombol cepat dari tab Lokasi. Memakai `n` sebagai pemicu; induk membersihkan preset lewat onPresetHandled
  // supaya panel yang di-mount ulang tidak membuka form lagi.
  useEffect(() => {
    if (!preset) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- membuka form sebagai respons event dari induk (satu kali per klik)
    openCreate(preset.locationId);
    onPresetHandled?.();
  }, [preset?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeFrom = (id: string) => {
    setFromId(id);
    void loadStock(id);
    setRows([{ ...EMPTY_ROW }]); // stok asal berbeda -> baris lama tidak berlaku
    if (id && id === toId) setToId('');
  };

  const stockOf = (productId: string) => stock.find(s => s.productId === productId);
  const rowQty = (r: FormRow) => parseFloat(r.qty) || 0;
  const activeLocs = locations.filter(l => l.isActive !== false);
  const locStockQty = (id: string) => (locationStock[id] ?? []).reduce((s, x) => s + (x.stockQty > 0 ? x.stockQty : 0), 0);
  const fromOptions = activeLocs
    .filter(l => l.id !== toId || l.id === fromId)
    .map(l => ({ value: l.id, label: `${l.name} · ${locStockQty(l.id)} pcs` }));
  const toOptions = locations
    .filter(l => l.id !== fromId && (l.isActive !== false || l.id === toId))
    .map(l => ({ value: l.id, label: l.isActive === false ? `${l.name} (nonaktif)` : l.name }));
  const productOptionsFor = (current: string) => stock
    .filter(s => (s.stockQty > 0 && !rows.some(r => r.productId === s.productId)) || s.productId === current)
    .map(s => ({ value: s.productId, label: `${s.productName} · sisa ${s.stockQty}` }));

  const filledRows = rows.filter(r => r.productId && rowQty(r) > 0);
  const overStock = rows.some(r => r.productId && rowQty(r) > (stockOf(r.productId)?.stockQty ?? 0));
  const formQty = filledRows.reduce((s, r) => s + rowQty(r), 0);
  const canSubmit = !!fromId && !!toId && fromId !== toId && !isNaN(new Date(date).getTime())
    && !stockLoading && filledRows.length > 0 && !overStock
    && rows.every(r => !r.productId || rowQty(r) > 0);

  const submit = async (approveNow: boolean) => {
    if (!canSubmit || saving) return;
    if (approveNow && !can('approve')) return;
    setSaving(true);
    try {
      const body = {
        fromLocationId: fromId, toLocationId: toId,
        items: filledRows.map(r => ({ productId: r.productId, qty: rowQty(r) })),
        note: note.trim() || undefined, date: new Date(date).toISOString(),
      };
      const res = editing
        ? await api<{ ok: boolean }>(`/${editing.id}`, { method: 'PUT', body })
        : await api<{ id: string }>('', { method: 'POST', body });
      if (!res.ok) { toast.error(res.error); return; }
      const id = editing?.id ?? (res.data as { id?: string }).id;
      let approveError: string | null = null;
      if (approveNow && id) {
        const ar = await api(`/${id}/approve`, { method: 'POST', body: {} });
        if (!ar.ok) approveError = ar.error;
      }
      if (approveNow && approveError) toast.error(`Draft tersimpan, tetapi approve gagal: ${approveError}`);
      else if (approveNow) toast.success('Transfer disimpan dan di-approve; stok berpindah.');
      else toast.success(editing ? 'Draft transfer diperbarui.' : 'Draft transfer disimpan; perlu di-approve agar stok berpindah.');
      setShowForm(false); setEditing(null);
      await Promise.all([load(), onStockChanged()]);
    } finally { setSaving(false); }
  };

  // ── Render helpers ──────────────────────────────────────────
  const locOf = (id: string, name: string) => locations.find(l => l.id === id) ?? { name };
  const rowBusy = (t: Transfer) => busyId === t.id || bulkBusy !== null;

  const renderBadge = (t: Transfer) => (
    <span className={`badge ${STATUS_BADGE[t.status]}`} style={{ fontSize: 10, padding: '1px 6px' }}>{STATUS_LABEL[t.status]}</span>
  );

  const renderRoute = (t: Transfer, size: number) => (
    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
      <MitraLogo location={locOf(t.fromLocationId, t.fromLocationName)} size={size} />
      <span className="text-sm font-bold break-words min-w-0" style={{ color: 'var(--text-primary)' }}>{t.fromLocationName}</span>
      <ArrowRight size={14} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} aria-label="ke" />
      <MitraLogo location={locOf(t.toLocationId, t.toLocationName)} size={size} />
      <span className="text-sm font-bold break-words min-w-0" style={{ color: 'var(--text-primary)' }}>{t.toLocationName}</span>
    </div>
  );

  const renderExtra = (t: Transfer) => {
    if (t.status === 'ditolak') return (
      <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>
        Ditolak{t.rejectedBy ? ` oleh ${t.rejectedBy}` : ''}{t.rejectedAt?.seconds ? ` · ${formatDate(t.rejectedAt.seconds)}` : ''}{t.rejectReason ? ` — ${t.rejectReason}` : ''}
      </p>
    );
    if (t.status === 'dibatalkan') return (
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        Dibatalkan{t.cancelledBy ? ` oleh ${t.cancelledBy}` : ''}{t.cancelledAt?.seconds ? ` · ${formatDate(t.cancelledAt.seconds)}` : ''}; stok dikembalikan ke mitra asal.
      </p>
    );
    if (t.status === 'approved') return t.approvedAt?.seconds ? (
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Approved{t.approvedBy ? ` oleh ${t.approvedBy}` : ''} · {formatDate(t.approvedAt.seconds)}</p>
    ) : null;
    return <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Draft — belum mengubah stok; menunggu approval.</p>;
  };

  const renderActions = (t: Transfer) => {
    const busy = rowBusy(t);
    return (
      <>
        {t.status === 'draft' && can('approve') && (
          <>
            <Tooltip label="Approve">
              <button onClick={() => approveOne(t)} disabled={busy} aria-label={`Approve ${t.docNumber}`}
                className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : <CircleCheck size={12} />}
              </button>
            </Tooltip>
            <Tooltip label="Tolak">
              <button onClick={() => { setRejectTarget(t); setRejectReason(''); }} disabled={busy} aria-label={`Tolak ${t.docNumber}`}
                className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                <CircleX size={12} />
              </button>
            </Tooltip>
          </>
        )}
        {t.status === 'draft' && can('edit') && (
          <Tooltip label="Edit">
            <button onClick={() => openEdit(t)} disabled={busy} aria-label={`Edit ${t.docNumber}`}
              className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
              <Pencil size={12} />
            </button>
          </Tooltip>
        )}
        {t.status === 'approved' && can('approve') && (
          <Tooltip label="Batalkan (stok dikembalikan)">
            <button onClick={() => cancelOne(t)} disabled={busy} aria-label={`Batalkan ${t.docNumber}`}
              className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
              {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
            </button>
          </Tooltip>
        )}
        {canDeleteStatus(t.status) && can('delete') && (
          <Tooltip label="Hapus">
            <button onClick={() => deleteOne(t)} disabled={busy} aria-label={`Hapus ${t.docNumber}`}
              className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              <Trash2 size={12} />
            </button>
          </Tooltip>
        )}
      </>
    );
  };

  const itemsSummary = (t: Transfer) => t.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', ');
  const count = (s: TransferStatus) => transfers.filter(x => x.status === s).length;
  const selectedList = transfers.filter(t => selected.has(t.id));
  const selDrafts = selectedList.filter(t => t.status === 'draft').length;
  const selDeletable = selectedList.filter(t => canDeleteStatus(t.status)).length;

  if (active && loading && transfers.length === 0) return <PageLoader />;

  return (
    <>
      {active && (
      <div className="p-4 lg:p-6 animate-fade-up space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          {transfers.length > 0 && (
            <div className="flex-shrink-0 w-full sm:w-[170px]" aria-label="Filter status transfer">
              <FilterSelect searchable={false} height={HEADER_BTN_H} value={statusFilter}
                onChange={v => { setStatusFilter(v as typeof statusFilter); setPage(1); }}
                options={[
                  { value: 'semua', label: 'Semua status', count: transfers.length },
                  { value: 'draft', label: 'Draft', count: count('draft') },
                  { value: 'approved', label: 'Approved', count: count('approved') },
                  { value: 'ditolak', label: 'Ditolak', count: count('ditolak') },
                  { value: 'dibatalkan', label: 'Dibatalkan', count: count('dibatalkan') },
                ]} />
            </div>
          )}
          {transfers.length > 0 && (
            <div className="relative flex-1 min-w-0 w-full sm:min-w-[220px]">
              <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                placeholder="Cari no. dokumen, mitra, atau produk…" aria-label="Cari transfer" />
            </div>
          )}
          <div className="flex items-center gap-2 justify-end flex-shrink-0 w-full sm:w-auto">
            {transfers.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
            {can('create') && (
              <button onClick={() => openCreate()} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                <Plus size={13} /> <span className="hidden sm:inline">Tambah Transfer</span>
              </button>
            )}
          </div>
        </div>

        {transfers.length === 0 ? (
          can('create')
            ? <EmptyAddCard label="Transfer Stok Antar Mitra" onClick={() => openCreate()} />
            : <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada transfer stok antar mitra.</p></div>
        ) : (
          <>
            {paginated.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                <Checkbox label="Pilih semua di halaman ini" checked={allPageSelected} indeterminate={somePageSelected && !allPageSelected} onChange={togglePageAll} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} transfer di halaman ini`}
                </span>
              </div>
            )}

            {paginated.length === 0 ? (
              <div className="card py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada transfer yang cocok.</p>
              </div>
            ) : view === 'table' ? (
              <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                {paginated.map((t, i) => {
                  const isSel = selected.has(t.id);
                  const num = (safePage - 1) * pageSize + i + 1;
                  return (
                    <div key={t.id} ref={el => { rowRefs.current[t.id] = el; }} className="flex items-start gap-3 px-4 py-3" style={{ transition: 'background-color 0.6s ease', background: flashId === t.id ? 'var(--accent-bg)' : isSel ? 'rgba(212,105,30,0.05)' : undefined }}>
                      <span className="pt-0.5 w-6 text-xs font-bold text-right flex-shrink-0 tabular" style={{ color: 'var(--text-muted)' }}>{num}</span>
                      <div className="pt-0.5"><Checkbox label={`Pilih ${t.docNumber}`} checked={isSel} onChange={() => toggleSelect(t.id)} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{t.docNumber}</span>
                          {renderBadge(t)}
                          <span className="text-sm font-bold tabular ml-auto" style={{ color: 'var(--accent)' }}>{totalQty(t)} pcs</span>
                        </div>
                        {renderRoute(t, 28)}
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{formatDate(t.docDate?.seconds ?? t.createdAt?.seconds)}</p>
                        <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>{itemsSummary(t)}</p>
                        {t.note && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{t.note}&rdquo;</p>}
                        {renderExtra(t)}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">{renderActions(t)}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {paginated.map(t => {
                  const isSel = selected.has(t.id);
                  return (
                    <div key={t.id} ref={el => { rowRefs.current[t.id] = el; }} className="card overflow-hidden p-4" style={{ transition: 'background-color 0.6s ease', background: flashId === t.id ? 'var(--accent-bg)' : undefined, outline: isSel ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                      <div className="flex items-center gap-2 mb-2">
                        <Checkbox label={`Pilih ${t.docNumber}`} checked={isSel} onChange={() => toggleSelect(t.id)} />
                        <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded truncate min-w-0"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{t.docNumber}</span>
                        {renderBadge(t)}
                        <div className="flex items-center gap-1 flex-shrink-0 ml-auto">{renderActions(t)}</div>
                      </div>
                      {renderRoute(t, 28)}
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{formatDate(t.docDate?.seconds ?? t.createdAt?.seconds)}</p>
                      <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>{itemsSummary(t)}</p>
                      {t.note && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>&ldquo;{t.note}&rdquo;</p>}
                      {renderExtra(t)}
                      <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Total item</span>
                        <span className="text-sm font-bold tabular" style={{ color: 'var(--text-primary)' }}>{totalQty(t)} pcs</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <Pagination total={filtered.length} safePage={safePage} totalPages={totalPages}
              pageSize={pageSize} onPageSize={n => { setPageSize(n); setPage(1); }}
              onGoPage={p => setPage(Math.max(1, Math.min(p, totalPages)))} unit="transfer" />
          </>
        )}
      </div>
      )}

      {/* Modal dirender di luar pembungkus animate-fade-up (transform membuat fixed ikut relatif ke pembungkus). */}
      {showForm && (
        <Modal onClose={() => !saving && setShowForm(false)} className="modal-lg">
          <div className="modal-accent" />
          <span className="modal-handle" />
          <div className="modal-header">
            <div className="modal-header-left">
              <div className="modal-icon"><ArrowRightLeft size={17} /></div>
              <div>
                <p className="modal-title">{editing ? `Edit Draft ${editing.docNumber}` : 'Draft Transfer Mitra'}</p>
                <p className="modal-subtitle">
                  {can('approve') ? 'Simpan sebagai draft, atau Simpan & Approve agar stok langsung berpindah' : 'Disimpan sebagai draft; stok baru berpindah setelah di-approve'}
                </p>
              </div>
            </div>
            <Tooltip label="Tutup">
              <button onClick={() => setShowForm(false)} disabled={saving} className="modal-close" aria-label="Tutup"><X size={14} /></button>
            </Tooltip>
          </div>
          <div className="modal-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Mitra Asal" required>
                  <SearchSelect value={fromId} onChange={changeFrom} options={fromOptions}
                    placeholder="– Pilih Mitra Asal –" searchPlaceholder="Cari mitra…" />
                </Field>
                <Field label="Mitra Tujuan" required>
                  <SearchSelect value={toId} onChange={setToId} options={toOptions}
                    placeholder="– Pilih Mitra Tujuan –" searchPlaceholder="Cari mitra…" />
                </Field>
                <Field label="Tanggal &amp; Jam Dokumen">
                  <DateTimeInput value={date} onChange={setDate} />
                </Field>
              </div>

              <div>
                <label className="field-label" style={{ marginBottom: 0 }}>Produk Dipindahkan</label>
                {!fromId ? (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Pilih Mitra Asal dulu untuk melihat stoknya.</p>
                ) : stockLoading ? (
                  <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}><Loader2 size={12} className="animate-spin" /> Memuat stok mitra asal…</p>
                ) : stock.every(s => s.stockQty <= 0) ? (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--warning)' }}>Mitra asal tidak punya stok untuk dipindahkan.</p>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                      {rows.map((row, i) => {
                        const s = stockOf(row.productId);
                        const qty = rowQty(row);
                        const over = !!s && qty > s.stockQty;
                        return (
                          <div key={i} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                            <div className="flex items-center gap-2 mb-2">
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <SearchSelect value={row.productId}
                                  onChange={id => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, productId: id } : r))}
                                  options={productOptionsFor(row.productId)} placeholder="– Produk –" searchPlaceholder="Cari produk…" />
                              </div>
                              <Tooltip label="Hapus baris">
                                <button onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))} disabled={rows.length === 1}
                                  aria-label="Hapus baris" className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}>
                                  <X size={14} />
                                </button>
                              </Tooltip>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label style={fieldLabel} htmlFor={`tf-qty-${i}`}>Qty (pcs)</label>
                                <input id={`tf-qty-${i}`} type="number" inputMode="numeric" min="0" max={s?.stockQty} value={row.qty}
                                  onChange={e => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, qty: e.target.value } : r))}
                                  placeholder="0" className="input" aria-invalid={over}
                                  style={over ? { borderColor: 'var(--danger)' } : undefined} />
                              </div>
                              <div>
                                <span style={fieldLabel}>Sisa stok &amp; harga titip asal</span>
                                <p className="text-sm tabular pt-2" style={{ color: 'var(--text-secondary)' }}>
                                  {s ? <>{s.stockQty} pcs · {formatRp(s.hargaTitip)}</> : '–'}
                                </p>
                              </div>
                            </div>
                            {over && <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>Qty melebihi sisa stok ({s!.stockQty} pcs).</p>}
                          </div>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => setRows(prev => [...prev, { ...EMPTY_ROW }])}
                      disabled={rows.length >= stock.filter(s => s.stockQty > 0).length}
                      className="flex items-center gap-1 text-xs font-bold mt-2.5 disabled:opacity-40" style={{ color: 'var(--accent)' }}>
                      <Plus size={12} /> Tambah Baris Produk
                    </button>
                    <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                      Harga titip mengikuti harga mitra asal; di mitra tujuan dihitung rata-rata tertimbang.
                    </p>
                  </>
                )}
              </div>

              <Field label="Catatan">
                <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Catatan tambahan (opsional)" className="input" style={{ resize: 'vertical' }} />
              </Field>

              <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
                <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{formQty} pcs</span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button onClick={() => setShowForm(false)} disabled={saving} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
            <button onClick={() => submit(false)} disabled={saving || !canSubmit}
              className={can('approve') ? 'btn-ghost' : 'btn-primary'} style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
              {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Draft'}
            </button>
            {can('approve') && (
              <button onClick={() => submit(true)} disabled={saving || !canSubmit} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Memproses…' : 'Simpan & Approve'}
              </button>
            )}
          </div>
        </Modal>
      )}

      {rejectTarget && (
        <Modal onClose={() => !rejecting && setRejectTarget(null)} className="modal-sm">
          <div className="modal-accent" />
          <span className="modal-handle" />
          <div className="modal-header">
            <div className="modal-header-left">
              <div className="modal-icon"><CircleX size={17} /></div>
              <div>
                <p className="modal-title">Tolak Transfer</p>
                <p className="modal-subtitle">{rejectTarget.docNumber} · penolakan bersifat final</p>
              </div>
            </div>
            <Tooltip label="Tutup">
              <button onClick={() => setRejectTarget(null)} disabled={rejecting} className="modal-close" aria-label="Tutup"><X size={14} /></button>
            </Tooltip>
          </div>
          <div className="modal-body">
            <Field label="Alasan penolakan (opsional)">
              <textarea rows={4} value={rejectReason} onChange={e => setRejectReason(e.target.value)} maxLength={500}
                placeholder="Mis. qty salah, mitra tujuan tidak sesuai…" className="input" style={{ resize: 'vertical' }} autoFocus />
            </Field>
          </div>
          <div className="modal-footer">
            <button onClick={() => setRejectTarget(null)} disabled={rejecting} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
            <button onClick={submitReject} disabled={rejecting} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0', background: 'var(--danger)' }}>
              {rejecting ? <Loader2 size={14} className="animate-spin" /> : <CircleX size={14} />}
              {rejecting ? 'Menolak…' : 'Tolak Transfer'}
            </button>
          </div>
        </Modal>
      )}

      {active && selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            {can('approve') && selDrafts > 0 && (
              <button onClick={bulkApprove} disabled={bulkBusy !== null}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0 whitespace-nowrap"
                style={{ background: 'var(--success)', color: '#fff' }}>
                {bulkBusy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <CircleCheck size={13} />}
                Approve{selDrafts < selected.size ? ` (${selDrafts})` : ''}
              </button>
            )}
            {can('delete') && selDeletable > 0 && (
              <button onClick={bulkDelete} disabled={bulkBusy !== null}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0 whitespace-nowrap"
                style={{ background: 'var(--danger)', color: '#fff' }}>
                {bulkBusy === 'delete' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Hapus{selDeletable < selected.size ? ` (${selDeletable})` : ''}
              </button>
            )}
            <button onClick={() => setSelected(new Set())} disabled={bulkBusy !== null}
              className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}
    </>
  );
}
