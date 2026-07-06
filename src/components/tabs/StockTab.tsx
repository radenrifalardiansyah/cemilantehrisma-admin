'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import {
  Loader2, RefreshCw, Plus, TrendingUp, TrendingDown, Warehouse,
  X, ArrowLeft, Pencil, Trash2, MapPin, ChevronRight, Package,
  ArrowLeftRight, Check, Clock, ImageIcon,
} from 'lucide-react';
import { useViewMode, type ViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import ScrollChips from '@/components/ScrollChips';

const API = '';

type SubTab = 'stok' | 'masuk' | 'keluar' | 'transfer';

const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'stok',     label: 'Stok',     Icon: Warehouse },
  { id: 'masuk',    label: 'Masuk',    Icon: TrendingUp },
  { id: 'keluar',   label: 'Keluar',   Icon: TrendingDown },
  { id: 'transfer', label: 'Transfer', Icon: ArrowLeftRight },
];

interface WarehouseData {
  id: string;
  name: string;
  location: string;
  description: string;
}

interface ProductStock {
  productId: string;
  productName: string;
  stockQty: number;
}

interface TxEntry {
  id: string;
  type: 'in' | 'out' | 'transfer';
  warehouseId?: string;
  warehouseName?: string;
  fromWarehouseId?: string;
  fromWarehouseName?: string;
  toWarehouseId?: string;
  toWarehouseName?: string;
  productId: string;
  productName?: string;
  qty: number;
  note?: string;
  createdAt?: { seconds?: number; _seconds?: number };
}

interface Product {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  imageUrls?: string[];
  category?: string;
}

interface Category {
  id: string;
  label: string;
  emoji: string;
}

function formatDate(entry: Pick<TxEntry, 'createdAt'>) {
  const seconds = entry.createdAt?.seconds ?? entry.createdAt?._seconds;
  if (seconds)
    return new Date(seconds * 1000).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  return '–';
}

// ── WarehouseModal ────────────────────────────────────────────────────────────
interface WFormState { name: string; location: string; description: string }

function WarehouseModal({
  title, subtitle, form, saving, onChange, onClose, onSave, submitLabel,
}: {
  title: string; subtitle: string;
  form: WFormState; saving: boolean;
  onChange: (f: WFormState) => void;
  onClose: () => void; onSave: () => void;
  submitLabel: string;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Warehouse size={17} /></div>
            <div>
              <p className="modal-title">{title}</p>
              <p className="modal-subtitle">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {([
              { key: 'name',        label: 'Nama Gudang',     required: true,  placeholder: 'cth: Gudang Utama' },
              { key: 'location',    label: 'Lokasi / Alamat', required: false, placeholder: 'cth: Jl. Mawar No. 5, Bogor' },
              { key: 'description', label: 'Keterangan',      required: false, placeholder: 'cth: Gudang untuk produk kering (opsional)' },
            ] as const).map(f => (
              <div key={f.key}>
                <label className="field-label">
                  {f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                </label>
                <input
                  type="text"
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={e => onChange({ ...form, [f.key]: e.target.value })}
                  autoFocus={f.key === 'name'}
                  className="input"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Batal
          </button>
          <button onClick={onSave} disabled={saving || !form.name.trim()}
            className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── TxList — shared transaction list component ────────────────────────────────
function TxList({
  entries, loading, emptyLabel, warehouses, products, view,
}: {
  entries: TxEntry[];
  loading: boolean;
  emptyLabel: string;
  warehouses: WarehouseData[];
  products: Product[];
  view: ViewMode;
}) {
  const wName = (id?: string) => warehouses.find(w => w.id === id)?.name ?? id ?? '–';
  const pName = (entry: TxEntry) => entry.productName || products.find(p => p.id === entry.productId)?.name || entry.productId;
  const pEmoji = (id: string) => products.find(p => p.id === id)?.emoji ?? '📦';

  const typeBadge = (type: TxEntry['type']) => {
    if (type === 'in')       return { label: 'Masuk',    Icon: TrendingUp,     color: 'var(--success)', bg: 'var(--success-bg)' };
    if (type === 'out')      return { label: 'Keluar',   Icon: TrendingDown,   color: 'var(--danger)',  bg: 'var(--danger-bg)'  };
    return                          { label: 'Transfer', Icon: ArrowLeftRight, color: '#0284C7',        bg: '#EFF6FF'            };
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  if (entries.length === 0) return (
    <div className="rounded-2xl p-12 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
      <Clock size={24} style={{ color: 'var(--text-muted)', margin: '0 auto 10px', display: 'block' }} />
      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</p>
    </div>
  );

  const rows = entries.map(e => {
    const isIn = e.type === 'in';
    const isTransfer = e.type === 'transfer';
    const badge = typeBadge(e.type);
    const locationLabel = isTransfer
      ? `${e.fromWarehouseName || wName(e.fromWarehouseId)}  →  ${e.toWarehouseName || wName(e.toWarehouseId)}`
      : (e.warehouseName || wName(e.warehouseId));
    return { e, isIn, isTransfer, badge, locationLabel };
  });

  if (view === 'table') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(({ e, isIn, isTransfer, badge, locationLabel }) => (
        <div key={e.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', borderRadius: 12,
          background: 'var(--surface)', border: '1px solid var(--border-2)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: badge.bg, fontSize: 16,
          }}>
            {pEmoji(e.productId)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-1.5">
              <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pName(e)}
              </p>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em',
                color: badge.color, background: badge.bg, borderRadius: 999, padding: '1.5px 6px 1.5px 5px',
              }}>
                <badge.Icon size={9} strokeWidth={2.5} /> {badge.label}
              </span>
            </div>
            <p style={{
              fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
              display: 'flex', alignItems: 'center', gap: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {isTransfer ? <ArrowLeftRight size={10} style={{ flexShrink: 0 }} /> : <Warehouse size={10} style={{ flexShrink: 0 }} />}
              {locationLabel}
            </p>
            {e.note && (
              <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                &ldquo;{e.note}&rdquo;
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: badge.color, fontVariantNumeric: 'tabular-nums' }}>
              {isIn ? '+' : isTransfer ? '' : '–'}{e.qty} unit
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
              {formatDate(e)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map(({ e, isIn, isTransfer, badge, locationLabel }) => (
        <div key={e.id} className="card p-4" style={{ borderColor: 'var(--border-2)' }}>
          <div className="flex items-center justify-between mb-2">
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: badge.bg, fontSize: 18,
            }}>
              {pEmoji(e.productId)}
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em',
              color: badge.color, background: badge.bg, borderRadius: 999, padding: '2px 7px 2px 6px',
            }}>
              <badge.Icon size={9} strokeWidth={2.5} /> {badge.label}
            </span>
          </div>
          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{pName(e)}</p>
          <p className="text-xs mt-1 flex items-center gap-1.5 truncate" style={{ color: 'var(--text-muted)' }}>
            {isTransfer ? <ArrowLeftRight size={11} style={{ flexShrink: 0 }} /> : <Warehouse size={11} style={{ flexShrink: 0 }} />}
            {locationLabel}
          </p>
          {e.note && (
            <p className="text-xs mt-1 italic truncate" style={{ color: 'var(--text-muted)' }}>&ldquo;{e.note}&rdquo;</p>
          )}
          <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
            <p className="text-sm font-extrabold tabular" style={{ color: badge.color }}>
              {isIn ? '+' : isTransfer ? '' : '–'}{e.qty} unit
            </p>
            <p className="text-[11px] tabular" style={{ color: 'var(--text-muted)' }}>{formatDate(e)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function StockTab({
  creds,
  products = [],
  categories = [],
}: {
  creds: string;
  products?: Product[];
  categories?: Category[];
}) {
  const [subTab, setSubTab] = useState<SubTab>('stok');

  // Shared
  const [warehouses, setWarehouses]   = useState<WarehouseData[]>([]);
  const [loading, setLoading]         = useState(true);
  const [transactions, setTxs]        = useState<TxEntry[]>([]);
  const [txLoading, setTxLoading]     = useState(false);

  // Stok view
  const [stokView, setStokView]                     = useState<'warehouses' | 'stock'>('warehouses');
  const [selectedWarehouse, setSelectedWarehouse]   = useState<WarehouseData | null>(null);
  const [stocks, setStocks]                         = useState<ProductStock[]>([]);
  const [stockLoading, setStockLoading]             = useState(false);
  const [hoveredCard, setHoveredCard]               = useState<string | null>(null);
  const [stockCatFilter, setStockCatFilter]         = useState('semua');
  const [historyView, setHistoryView]               = useViewMode('stock-history');

  // Warehouse CRUD
  const [showWForm, setShowWForm]       = useState(false);
  const [editWarehouse, setEditWarehouse] = useState<WarehouseData | null>(null);
  const [wForm, setWForm]               = useState({ name: '', location: '', description: '' });
  const [savingW, setSavingW]           = useState(false);
  const [deletingId, setDeletingId]     = useState<string | null>(null);

  // Masuk / Keluar form
  const [txWId, setTxWId]           = useState('');
  const [txPId, setTxPId]           = useState('');
  const [txQty, setTxQty]           = useState('');
  const [txNote, setTxNote]         = useState('');
  const [txSubmitting, setTxSub]    = useState(false);
  const [txSuccess, setTxSuccess]   = useState(false);

  // Transfer form
  const [fromWId, setFromWId]       = useState('');
  const [toWId, setToWId]           = useState('');
  const [trPId, setTrPId]           = useState('');
  const [trQty, setTrQty]           = useState('');
  const [trNote, setTrNote]         = useState('');
  const [trSubmitting, setTrSub]    = useState(false);
  const [trSuccess, setTrSuccess]   = useState(false);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const loadWarehouses = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/warehouses`, { headers });
    if (r.ok) {
      const { warehouses: w } = await r.json() as { warehouses: WarehouseData[] };
      setWarehouses(w);
    }
    setLoading(false);
  };

  const loadTx = async () => {
    setTxLoading(true);
    const r = await fetch(`${API}/api/stock`, { headers });
    if (r.ok) {
      const { entries } = await r.json() as { entries: TxEntry[] };
      setTxs(entries);
    }
    setTxLoading(false);
  };

  const loadStock = async (warehouseId: string) => {
    setStockLoading(true);
    const r = await fetch(`${API}/api/warehouses/${warehouseId}/stock`, { headers });
    if (r.ok) {
      const { stocks: s } = await r.json() as { stocks: ProductStock[] };
      setStocks(s);
    }
    setStockLoading(false);
  };

  useEffect(() => { loadWarehouses(); }, []);

  useEffect(() => {
    if (subTab !== 'stok') loadTx();
  }, [subTab]);

  // ── Warehouse actions ──
  const openWarehouse = async (w: WarehouseData) => {
    setSelectedWarehouse(w);
    setStokView('stock');
    setStockCatFilter('semua');
    await loadStock(w.id);
  };

  const backToWarehouses = () => {
    setStokView('warehouses');
    setSelectedWarehouse(null);
    setStocks([]);
    setStockCatFilter('semua');
  };

  const openCreate = () => {
    setEditWarehouse(null);
    setWForm({ name: '', location: '', description: '' });
    setShowWForm(true);
  };

  const openEdit = (w: WarehouseData, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditWarehouse(w);
    setWForm({ name: w.name, location: w.location, description: w.description });
    setShowWForm(true);
  };

  const saveWarehouse = async () => {
    if (!wForm.name.trim()) return;
    setSavingW(true);
    if (editWarehouse) {
      await fetch(`${API}/api/warehouses/${editWarehouse.id}`, { method: 'PUT', headers, body: JSON.stringify(wForm) });
    } else {
      await fetch(`${API}/api/warehouses`, { method: 'POST', headers, body: JSON.stringify(wForm) });
    }
    setShowWForm(false);
    await loadWarehouses();
    setSavingW(false);
  };

  const deleteWarehouse = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Hapus gudang ini? Semua data stok di gudang ini juga akan dihapus.')) return;
    setDeletingId(id);
    await fetch(`${API}/api/warehouses/${id}`, { method: 'DELETE', headers });
    await loadWarehouses();
    setDeletingId(null);
  };

  // ── Submit masuk / keluar ──
  const submitTx = async (type: 'in' | 'out') => {
    if (!txWId || !txPId || !txQty || Number(txQty) <= 0) return;
    setTxSub(true);
    const wh   = warehouses.find(w => w.id === txWId);
    const prod = products.find(p => p.id === txPId);
    const r = await fetch(`${API}/api/warehouses/${txWId}/stock`, {
      method: 'POST', headers,
      body: JSON.stringify({
        productId: txPId,
        productName: prod?.name ?? '',
        warehouseName: wh?.name ?? '',
        type, qty: Number(txQty), note: txNote,
      }),
    });
    if (r.ok) {
      setTxWId(''); setTxPId(''); setTxQty(''); setTxNote('');
      setTxSuccess(true);
      setTimeout(() => setTxSuccess(false), 2500);
      await loadTx();
    }
    setTxSub(false);
  };

  // ── Submit transfer ──
  const submitTransfer = async () => {
    if (!fromWId || !toWId || !trPId || !trQty || Number(trQty) <= 0 || fromWId === toWId) return;
    setTrSub(true);
    const fromWh = warehouses.find(w => w.id === fromWId);
    const toWh   = warehouses.find(w => w.id === toWId);
    const prod   = products.find(p => p.id === trPId);
    const r = await fetch(`${API}/api/stock/transfer`, {
      method: 'POST', headers,
      body: JSON.stringify({
        fromWarehouseId: fromWId, fromWarehouseName: fromWh?.name ?? '',
        toWarehouseId: toWId,     toWarehouseName: toWh?.name ?? '',
        productId: trPId, productName: prod?.name ?? '',
        qty: Number(trQty), note: trNote,
      }),
    });
    if (r.ok) {
      setFromWId(''); setToWId(''); setTrPId(''); setTrQty(''); setTrNote('');
      setTrSuccess(true);
      setTimeout(() => setTrSuccess(false), 2500);
      await loadTx();
    }
    setTrSub(false);
  };

  // ── Loading ──
  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  const inTx       = transactions.filter(t => t.type === 'in');
  const outTx      = transactions.filter(t => t.type === 'out');
  const transferTx = transactions.filter(t => t.type === 'transfer');

  // ── Shared form row style ──
  const fieldLabel = { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6, display: 'block' };

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>

      {/* Sub-navigation */}
      <ScrollChips
        className="flex-shrink-0 px-4 pt-3.5 pb-3"
        style={{ borderBottom: '1px solid var(--border-2)' }}
      >
        {SUB_TABS.map(tab => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`tab-chip${active ? ' active' : ''}`}
            >
              <tab.Icon size={13} strokeWidth={active ? 2.3 : 1.8} />
              {tab.label}
            </button>
          );
        })}
      </ScrollChips>

      {/* Content */}
      <div className="flex-1 overflow-y-auto thin-scrollbar">

        {/* ════ STOK ════════════════════════════════════════════ */}
        {subTab === 'stok' && stokView === 'warehouses' && (
          <div className="p-4 lg:p-6 animate-fade-up">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Manajemen Gudang</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{warehouses.length} gudang terdaftar</p>
              </div>
              <button onClick={loadWarehouses} className="btn-ghost p-2.5" title="Refresh">
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { icon: <Warehouse size={16} />, label: 'Total Gudang', val: warehouses.length, color: 'var(--accent)' },
                { icon: <Package   size={16} />, label: 'Aktif',        val: warehouses.length, color: 'var(--success)' },
              ].map((c, i) => (
                <div key={i} className="card p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent-bg)', color: c.color }}>
                    {c.icon}
                  </div>
                  <div>
                    <p className="text-xl font-extrabold tabular leading-none" style={{ color: c.color }}>{c.val}</p>
                    <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {warehouses.length === 0 ? (
              <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
                  <Warehouse size={28} style={{ color: 'var(--accent)' }} />
                </div>
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada gudang</p>
                <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>Tambahkan gudang untuk mulai mengelola stok per lokasi</p>
                <button onClick={openCreate} className="btn-primary mx-auto px-5 py-2.5 text-sm">
                  <Plus size={14} /> Tambah Gudang Pertama
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {warehouses.map(w => (
                  <div key={w.id} onClick={() => openWarehouse(w)}
                    onMouseEnter={() => setHoveredCard(w.id)}
                    onMouseLeave={() => setHoveredCard(null)}
                    className="card cursor-pointer overflow-hidden"
                    style={{
                      transition: 'box-shadow 0.18s, transform 0.18s',
                      boxShadow: hoveredCard === w.id ? '0 6px 24px rgba(0,0,0,0.09)' : '',
                      transform:  hoveredCard === w.id ? 'translateY(-2px)' : '',
                    }}
                  >
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-bg)' }}>
                          <Warehouse size={20} style={{ color: 'var(--accent)' }} />
                        </div>
                        <div className="flex items-center gap-1"
                          style={{ opacity: hoveredCard === w.id ? 1 : 0, transition: 'opacity 0.15s' }}
                          onClick={e => e.stopPropagation()}>
                          <button onClick={e => openEdit(w, e)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                            title="Edit">
                            <Pencil size={12} />
                          </button>
                          <button onClick={e => deleteWarehouse(w.id, e)}
                            disabled={deletingId === w.id}
                            className="w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
                            title="Hapus">
                            {deletingId === w.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </div>
                      <p className="font-bold text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>{w.name}</p>
                      {w.location ? (
                        <div className="flex items-center gap-1 mt-1.5">
                          <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{w.location}</p>
                        </div>
                      ) : (
                        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Tidak ada lokasi</p>
                      )}
                      {w.description && (
                        <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>{w.description}</p>
                      )}
                      <div className="flex items-center justify-between mt-4 pt-3.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                        <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Lihat Stok</span>
                        <ChevronRight size={14} style={{ color: 'var(--accent)' }} />
                      </div>
                    </div>
                  </div>
                ))}

                <button onClick={openCreate}
                  className="rounded-2xl flex flex-col items-center justify-center gap-2.5 p-6 min-h-[160px] transition-colors"
                  style={{ border: '2px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'var(--surface-2)'; el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent'; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text-muted)'; }}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                    <Plus size={20} />
                  </div>
                  <span className="text-sm font-semibold">Tambah Gudang</span>
                </button>
              </div>
            )}

            {showWForm && (
              <WarehouseModal
                title={editWarehouse ? 'Edit Gudang' : 'Tambah Gudang Baru'}
                subtitle={editWarehouse ? 'Perbarui informasi gudang' : 'Isi detail gudang baru'}
                form={wForm} saving={savingW}
                onChange={setWForm}
                onClose={() => setShowWForm(false)}
                onSave={saveWarehouse}
                submitLabel={editWarehouse ? 'Simpan Perubahan' : 'Tambah Gudang'}
              />
            )}
          </div>
        )}

        {/* Stok per gudang — READ ONLY */}
        {subTab === 'stok' && stokView === 'stock' && (
          <div className="p-4 lg:p-6 animate-fade-up">
            <div className="flex items-center gap-3 mb-6">
              <button onClick={backToWarehouses} className="btn-ghost p-2 flex-shrink-0" title="Kembali">
                <ArrowLeft size={16} />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-extrabold truncate" style={{ color: 'var(--text-primary)' }}>
                  {selectedWarehouse?.name}
                </h2>
                {selectedWarehouse?.location && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin size={10} style={{ color: 'var(--text-muted)' }} />
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{selectedWarehouse.location}</p>
                  </div>
                )}
              </div>
              <button onClick={() => selectedWarehouse && loadStock(selectedWarehouse.id)}
                className="btn-ghost p-2.5 flex-shrink-0" title="Refresh">
                <RefreshCw size={14} className={stockLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { icon: <Package      size={16} />, label: 'Jenis Produk', val: stocks.length,                              color: 'var(--accent)'  },
                { icon: <TrendingUp   size={16} />, label: 'Total Unit',   val: stocks.reduce((s, x) => s + x.stockQty, 0), color: 'var(--success)' },
                { icon: <TrendingDown size={16} />, label: 'Stok Rendah',  val: stocks.filter(x => x.stockQty < 10).length, color: 'var(--danger)'  },
              ].map((c, i) => (
                <div key={i} className="card p-4">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3"
                    style={{ background: 'var(--accent-bg)', color: c.color }}>
                    {c.icon}
                  </div>
                  <p className="text-xl font-extrabold tabular" style={{ color: c.color }}>{c.val}</p>
                  <p className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                </div>
              ))}
            </div>

            {stockLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : stocks.length === 0 ? (
              <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <Package size={24} style={{ color: 'var(--accent)', margin: '0 auto 10px', display: 'block' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada stok</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tambahkan stok lewat menu <strong>Masuk</strong>.</p>
              </div>
            ) : (() => {
              const withCat = stocks.map(s => ({ ...s, category: products.find(p => p.id === s.productId)?.category ?? '' }));
              const catLabel = (id: string) => categories.find(c => c.id === id)?.label ?? id;
              const catEmoji = (id: string) => categories.find(c => c.id === id)?.emoji ?? '🏷️';
              const catIds = Array.from(new Set(withCat.map(s => s.category).filter(Boolean)));
              const catCounts = catIds.map(id => ({ id, label: catLabel(id), emoji: catEmoji(id), count: withCat.filter(s => s.category === id).length }));
              const visible = stockCatFilter === 'semua' ? withCat : withCat.filter(s => s.category === stockCatFilter);

              return (
                <>
                  {catCounts.length > 0 && (
                    <ScrollChips className="mb-4">
                      <button onClick={() => setStockCatFilter('semua')}
                        className={`tab-chip text-xs py-1.5 ${stockCatFilter === 'semua' ? 'active' : ''}`}>
                        Semua ({withCat.length})
                      </button>
                      {catCounts.map(c => (
                        <button key={c.id} onClick={() => setStockCatFilter(c.id)}
                          className={`tab-chip text-xs py-1.5 ${stockCatFilter === c.id ? 'active' : ''}`}>
                          {c.emoji} {c.label} ({c.count})
                        </button>
                      ))}
                    </ScrollChips>
                  )}

                  {visible.length === 0 ? (
                    <div className="rounded-2xl p-12 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Tidak ada produk di kategori ini.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {visible.map(s => {
                        const prod    = products.find(p => p.id === s.productId);
                        const imgUrl  = prod?.imageUrls?.[0];
                        const emoji   = prod?.emoji   ?? '📦';
                        const bgColor = prod?.bgColor ?? '#F5F0E9';
                        const qty = s.stockQty;
                        const qtyStyle = qty === 0
                          ? { bg: '#FEF2F2', color: '#DC2626', border: '#FECACA' }
                          : qty < 10
                            ? { bg: '#FDF0E6', color: '#A84F10', border: 'rgba(212,105,30,0.25)' }
                            : { bg: '#F0FDF4', color: '#15803D', border: '#D1FAE5' };
                        return (
                          <div key={s.productId} className="card overflow-hidden flex flex-col select-none">
                            <div className="relative w-full aspect-square" style={{ background: `${bgColor}22` }}>
                              {imgUrl ? (
                                <Image src={imgUrl} alt={s.productName} fill className="object-contain" sizes="(max-width: 640px) 50vw, 200px" unoptimized />
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-4xl">{emoji}</div>
                              )}
                              <div className="absolute top-2 right-2 text-[10px] font-black px-2 py-0.5 rounded-full"
                                style={{ background: qtyStyle.bg, color: qtyStyle.color, border: `1px solid ${qtyStyle.border}` }}>
                                {qty} unit
                              </div>
                              {!imgUrl && (
                                <div className="absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center"
                                  style={{ background: 'rgba(0,0,0,0.35)' }} title="Belum ada foto">
                                  <ImageIcon size={10} color="#fff" />
                                </div>
                              )}
                            </div>
                            <div className="px-3 pt-2 pb-3">
                              <p className="text-[11px] font-bold leading-snug line-clamp-2"
                                style={{ color: 'var(--text-primary)' }}>
                                {s.productName}
                              </p>
                              {s.category && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-1.5"
                                  style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                                  <span style={{ fontSize: 9, lineHeight: 1 }}>{catEmoji(s.category)}</span>
                                  {catLabel(s.category)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* ════ MASUK ═══════════════════════════════════════════ */}
        {subTab === 'masuk' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                  <TrendingUp size={17} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Catat Stok Masuk</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Penerimaan barang dari supplier atau penambahan stok</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Gudang</label>
                    <select className="input" value={txWId} onChange={e => setTxWId(e.target.value)}>
                      <option value="">– Pilih Gudang –</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={fieldLabel}>Produk</label>
                    <select className="input" value={txPId} onChange={e => setTxPId(e.target.value)}>
                      <option value="">– Pilih Produk –</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Jumlah Unit <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="number" min={1} placeholder="cth: 50" value={txQty}
                      onChange={e => setTxQty(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Keterangan</label>
                    <input type="text" placeholder="cth: Restock dari supplier (opsional)" value={txNote}
                      onChange={e => setTxNote(e.target.value)} className="input" />
                  </div>
                </div>

                <button
                  onClick={() => submitTx('in')}
                  disabled={txSubmitting || !txWId || !txPId || !txQty || Number(txQty) <= 0}
                  className="btn-primary justify-center py-3 text-sm"
                  style={{ background: txSuccess ? 'var(--success)' : undefined }}
                >
                  {txSubmitting
                    ? <><Loader2 size={15} className="animate-spin" /> Menyimpan…</>
                    : txSuccess
                      ? <><Check size={15} /> Tersimpan!</>
                      : <><Plus size={15} /> Tambah Stok Masuk</>}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={11} /> Riwayat Masuk ({inTx.length})
                </p>
                <div className="flex items-center gap-2">
                  <ViewToggle mode={historyView} onChange={setHistoryView} />
                  <button onClick={loadTx} className="btn-ghost p-1.5" title="Refresh">
                    <RefreshCw size={13} className={txLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              <TxList entries={inTx} loading={txLoading} emptyLabel="Belum ada transaksi stok masuk"
                warehouses={warehouses} products={products} view={historyView} />
            </div>
          </div>
        )}

        {/* ════ KELUAR ══════════════════════════════════════════ */}
        {subTab === 'keluar' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                  <TrendingDown size={17} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Catat Stok Keluar</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pengurangan stok — rusak, terpakai, retur, dll.</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Gudang</label>
                    <select className="input" value={txWId} onChange={e => setTxWId(e.target.value)}>
                      <option value="">– Pilih Gudang –</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={fieldLabel}>Produk</label>
                    <select className="input" value={txPId} onChange={e => setTxPId(e.target.value)}>
                      <option value="">– Pilih Produk –</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Jumlah Unit <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="number" min={1} placeholder="cth: 10" value={txQty}
                      onChange={e => setTxQty(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Keterangan</label>
                    <input type="text" placeholder="cth: Barang rusak saat pengiriman (opsional)" value={txNote}
                      onChange={e => setTxNote(e.target.value)} className="input" />
                  </div>
                </div>

                <button
                  onClick={() => submitTx('out')}
                  disabled={txSubmitting || !txWId || !txPId || !txQty || Number(txQty) <= 0}
                  className="btn-primary justify-center py-3 text-sm"
                  style={{
                    background: txSuccess
                      ? 'var(--success)'
                      : 'linear-gradient(135deg,#DC2626,#B91C1C)',
                  }}
                >
                  {txSubmitting
                    ? <><Loader2 size={15} className="animate-spin" /> Menyimpan…</>
                    : txSuccess
                      ? <><Check size={15} /> Tersimpan!</>
                      : <><TrendingDown size={15} /> Kurangi Stok</>}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={11} /> Riwayat Keluar ({outTx.length})
                </p>
                <div className="flex items-center gap-2">
                  <ViewToggle mode={historyView} onChange={setHistoryView} />
                  <button onClick={loadTx} className="btn-ghost p-1.5" title="Refresh">
                    <RefreshCw size={13} className={txLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              <TxList entries={outTx} loading={txLoading} emptyLabel="Belum ada transaksi stok keluar"
                warehouses={warehouses} products={products} view={historyView} />
            </div>
          </div>
        )}

        {/* ════ TRANSFER ════════════════════════════════════════ */}
        {subTab === 'transfer' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#EFF6FF', color: '#0284C7' }}>
                  <ArrowLeftRight size={17} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Transfer Antar Gudang</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pindahkan stok dari satu gudang ke gudang lain</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Dari Gudang <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <select className="input" value={fromWId} onChange={e => setFromWId(e.target.value)}>
                      <option value="">– Pilih Asal –</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={fieldLabel}>Ke Gudang <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <select className="input" value={toWId} onChange={e => setToWId(e.target.value)}>
                      <option value="">– Pilih Tujuan –</option>
                      {warehouses.filter(w => w.id !== fromWId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Produk <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <select className="input" value={trPId} onChange={e => setTrPId(e.target.value)}>
                      <option value="">– Pilih Produk –</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={fieldLabel}>Jumlah Unit <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="number" min={1} placeholder="cth: 20" value={trQty}
                      onChange={e => setTrQty(e.target.value)} className="input" />
                  </div>
                </div>

                <div>
                  <label style={fieldLabel}>Keterangan</label>
                  <input type="text" placeholder="cth: Redistribusi stok akhir bulan (opsional)" value={trNote}
                    onChange={e => setTrNote(e.target.value)} className="input" />
                </div>

                {fromWId && toWId && fromWId === toWId && (
                  <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                    Gudang asal dan tujuan tidak boleh sama.
                  </p>
                )}

                <button
                  onClick={submitTransfer}
                  disabled={trSubmitting || !fromWId || !toWId || !trPId || !trQty || Number(trQty) <= 0 || fromWId === toWId}
                  className="btn-primary justify-center py-3 text-sm"
                  style={{
                    background: trSuccess
                      ? 'var(--success)'
                      : 'linear-gradient(135deg,#0284C7,#0369A1)',
                  }}
                >
                  {trSubmitting
                    ? <><Loader2 size={15} className="animate-spin" /> Memproses…</>
                    : trSuccess
                      ? <><Check size={15} /> Transfer Berhasil!</>
                      : <><ArrowLeftRight size={15} /> Proses Transfer</>}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={11} /> Riwayat Transfer ({transferTx.length})
                </p>
                <div className="flex items-center gap-2">
                  <ViewToggle mode={historyView} onChange={setHistoryView} />
                  <button onClick={loadTx} className="btn-ghost p-1.5" title="Refresh">
                    <RefreshCw size={13} className={txLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              <TxList entries={transferTx} loading={txLoading} emptyLabel="Belum ada transaksi transfer"
                warehouses={warehouses} products={products} view={historyView} />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
