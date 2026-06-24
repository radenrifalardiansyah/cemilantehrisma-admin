'use client';

import { useState, useEffect } from 'react';
import {
  Loader2, RefreshCw, Plus, TrendingUp, TrendingDown, Warehouse,
  ChevronDown, ChevronUp, X, ArrowLeft, Pencil, Trash2, MapPin,
  ChevronRight, Package,
} from 'lucide-react';

const API = '';

interface WarehouseData {
  id: string;
  name: string;
  location: string;
  description: string;
}

interface StockEntry {
  id: string;
  type: 'in' | 'out';
  qty: number;
  note: string;
  createdAt?: { seconds: number };
}

interface ProductStock {
  productId: string;
  productName: string;
  stockQty: number;
  entries?: StockEntry[];
}

function formatDate(e: StockEntry) {
  if (e.createdAt?.seconds)
    return new Date(e.createdAt.seconds * 1000).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  return '–';
}

// ── Palette for warehouse cards (cycles) ──────────────────────────────────────
const CARD_COLORS = [
  { bg: 'linear-gradient(135deg,#D97706,#EA580C)', icon: '#FDE68A', soft: '#FFFBEB' },
  { bg: 'linear-gradient(135deg,#0284C7,#0EA5E9)', icon: '#BAE6FD', soft: '#F0F9FF' },
  { bg: 'linear-gradient(135deg,#15803D,#22C55E)', icon: '#BBF7D0', soft: '#F0FDF4' },
  { bg: 'linear-gradient(135deg,#7C3AED,#A855F7)', icon: '#E9D5FF', soft: '#FAF5FF' },
];

export default function StockTab({ creds }: { creds: string }) {
  const [view, setView]                           = useState<'warehouses' | 'stock'>('warehouses');
  const [warehouses, setWarehouses]               = useState<WarehouseData[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseData | null>(null);
  const [selectedIdx, setSelectedIdx]             = useState(0);
  const [stocks, setStocks]                       = useState<ProductStock[]>([]);
  const [loading, setLoading]                     = useState(true);
  const [stockLoading, setStockLoading]           = useState(false);

  // Warehouse form
  const [showWForm, setShowWForm]         = useState(false);
  const [editWarehouse, setEditWarehouse] = useState<WarehouseData | null>(null);
  const [wForm, setWForm]                 = useState({ name: '', location: '', description: '' });
  const [savingW, setSavingW]             = useState(false);
  const [deletingId, setDeletingId]       = useState<string | null>(null);

  // Stock entry form
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm]     = useState<string | null>(null);
  const [form, setForm]             = useState({ type: 'in' as 'in' | 'out', qty: '', note: '' });
  const [submitting, setSubmitting] = useState(false);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadWarehouses = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/warehouses`, { headers });
    if (r.ok) {
      const { warehouses: w } = await r.json() as { warehouses: WarehouseData[] };
      setWarehouses(w);
    }
    setLoading(false);
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

  const loadEntries = async (warehouseId: string, productId: string) => {
    const r = await fetch(`${API}/api/warehouses/${warehouseId}/stock/${productId}`, { headers });
    if (r.ok) {
      const { entries } = await r.json() as { entries: StockEntry[] };
      setStocks(s => s.map(x => x.productId === productId ? { ...x, entries } : x));
    }
  };

  useEffect(() => { loadWarehouses(); }, []);

  // ── Navigation ────────────────────────────────────────────────────────────

  const openWarehouse = async (w: WarehouseData, idx: number) => {
    setSelectedWarehouse(w);
    setSelectedIdx(idx);
    setView('stock');
    setExpandedId(null);
    setShowForm(null);
    await loadStock(w.id);
  };

  const backToWarehouses = () => {
    setView('warehouses');
    setSelectedWarehouse(null);
    setStocks([]);
  };

  // ── Warehouse CRUD ────────────────────────────────────────────────────────

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
      await fetch(`${API}/api/warehouses/${editWarehouse.id}`, {
        method: 'PUT', headers, body: JSON.stringify(wForm),
      });
    } else {
      await fetch(`${API}/api/warehouses`, {
        method: 'POST', headers, body: JSON.stringify(wForm),
      });
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

  // ── Stock entry ───────────────────────────────────────────────────────────

  const toggleExpand = async (productId: string) => {
    if (expandedId === productId) { setExpandedId(null); return; }
    setExpandedId(productId);
    if (selectedWarehouse) await loadEntries(selectedWarehouse.id, productId);
  };

  const submitEntry = async (productId: string, productName: string) => {
    if (!form.qty || Number(form.qty) <= 0 || !selectedWarehouse) return;
    setSubmitting(true);
    const r = await fetch(`${API}/api/warehouses/${selectedWarehouse.id}/stock`, {
      method: 'POST', headers,
      body: JSON.stringify({
        productId, productName,
        type: form.type, qty: Number(form.qty), note: form.note,
      }),
    });
    if (r.ok) {
      setForm({ type: 'in', qty: '', note: '' });
      setShowForm(null);
      await loadStock(selectedWarehouse.id);
      if (expandedId === productId) await loadEntries(selectedWarehouse.id, productId);
    }
    setSubmitting(false);
  };

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW — Daftar Gudang
  // ══════════════════════════════════════════════════════════════════════════

  if (view === 'warehouses') return (
    <div className="animate-fade-up">

      {/* ── Hero banner ─────────────────────────────────────────── */}
      <div
        className="px-6 pt-8 pb-6"
        style={{
          background: 'linear-gradient(135deg, #9B4418 0%, #7A3008 100%)',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.15)' }}>
                <Warehouse size={18} color="#FDE68A" />
              </div>
              <h1 className="text-xl font-extrabold" style={{ color: '#FDECD0' }}>
                Manajemen Gudang
              </h1>
            </div>
            <p className="text-sm mt-1" style={{ color: 'rgba(253,236,208,0.65)', paddingLeft: 2 }}>
              Kelola gudang dan pantau stok per lokasi
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={loadWarehouses}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#FDE68A' }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: '#FDE68A', color: '#7A3008' }}
            >
              <Plus size={15} />
              Tambah Gudang
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 mt-5">
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <p className="text-2xl font-extrabold tabular" style={{ color: '#FDECD0' }}>{warehouses.length}</p>
            <p className="text-xs font-medium mt-0.5" style={{ color: 'rgba(253,236,208,0.65)' }}>Total Gudang</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <p className="text-2xl font-extrabold tabular" style={{ color: '#FDECD0' }}>
              {warehouses.length > 0 ? '–' : '0'}
            </p>
            <p className="text-xs font-medium mt-0.5" style={{ color: 'rgba(253,236,208,0.65)' }}>
              Klik gudang untuk lihat stok
            </p>
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="p-4 lg:p-6">
        {warehouses.length === 0 ? (

          /* Empty state */
          <div
            className="rounded-3xl p-12 text-center"
            style={{
              background: 'var(--surface)',
              border: '2px dashed var(--border)',
            }}
          >
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'var(--accent-bg)' }}
            >
              <Warehouse size={36} style={{ color: 'var(--accent)' }} />
            </div>
            <p className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Belum ada gudang
            </p>
            <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
              Tambahkan gudang untuk mulai mengelola stok per lokasi
            </p>
            <button
              onClick={openCreate}
              className="btn-primary mx-auto px-5 py-2.5 text-sm"
            >
              <Plus size={15} /> Tambah Gudang Pertama
            </button>
          </div>

        ) : (

          /* Warehouse grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {warehouses.map((w, i) => {
              const pal = CARD_COLORS[i % CARD_COLORS.length];
              return (
                <div
                  key={w.id}
                  onClick={() => openWarehouse(w, i)}
                  className="card cursor-pointer group overflow-hidden transition-all duration-200"
                  style={{ border: '1px solid var(--border-2)' }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.transform = '';
                    (e.currentTarget as HTMLElement).style.boxShadow = '';
                  }}
                >
                  {/* Card top gradient */}
                  <div
                    className="h-2 w-full"
                    style={{ background: pal.bg }}
                  />

                  <div className="p-4">
                    {/* Icon + actions */}
                    <div className="flex items-start justify-between mb-3">
                      <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center"
                        style={{ background: pal.soft }}
                      >
                        <Warehouse size={22} style={{ color: 'var(--accent)' }} />
                      </div>
                      {/* Action buttons — visible on hover */}
                      <div
                        className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={e => openEdit(w, e)}
                          title="Edit"
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--border-2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={e => deleteWarehouse(w.id, e)}
                          disabled={deletingId === w.id}
                          title="Hapus"
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                          style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
                        >
                          {deletingId === w.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Trash2 size={12} />}
                        </button>
                      </div>
                    </div>

                    {/* Name */}
                    <p className="text-sm font-bold leading-snug mb-1" style={{ color: 'var(--text-primary)' }}>
                      {w.name}
                    </p>

                    {/* Location */}
                    {w.location ? (
                      <div className="flex items-center gap-1 mb-1">
                        <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{w.location}</p>
                      </div>
                    ) : (
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>–</p>
                    )}

                    {/* Description */}
                    {w.description && (
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {w.description}
                      </p>
                    )}

                    {/* CTA */}
                    <div
                      className="flex items-center justify-between mt-4 pt-3"
                      style={{ borderTop: '1px solid var(--border-2)' }}
                    >
                      <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                        Lihat Stok
                      </span>
                      <ChevronRight size={14} style={{ color: 'var(--accent)' }} />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add new card */}
            <button
              onClick={openCreate}
              className="rounded-2xl flex flex-col items-center justify-center gap-2 p-6 transition-colors min-h-[160px]"
              style={{
                border: '2px dashed var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
              }}
            >
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--surface-2)', transition: 'background 0.15s' }}>
                <Plus size={20} />
              </div>
              <span className="text-sm font-semibold">Tambah Gudang</span>
            </button>
          </div>

        )}
      </div>

      {/* ── Modal Create / Edit ──────────────────────────────────── */}
      {showWForm && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowWForm(false); }}
        >
          <div
            className="w-full sm:max-w-md p-6 space-y-5 animate-slide-up sm:animate-scale-in"
            style={{
              background: 'var(--surface)',
              borderRadius: '24px 24px 0 0',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                  {editWarehouse ? 'Edit Gudang' : 'Tambah Gudang Baru'}
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {editWarehouse ? 'Perbarui informasi gudang' : 'Isi detail gudang baru'}
                </p>
              </div>
              <button onClick={() => setShowWForm(false)} className="btn-ghost p-2">
                <X size={15} />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Nama Gudang <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text" placeholder="cth: Gudang Utama"
                  value={wForm.name}
                  onChange={e => setWForm(f => ({ ...f, name: e.target.value }))}
                  className="input text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Lokasi / Alamat
                </label>
                <input
                  type="text" placeholder="cth: Jl. Mawar No. 5, Malang"
                  value={wForm.location}
                  onChange={e => setWForm(f => ({ ...f, location: e.target.value }))}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Keterangan <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opsional)</span>
                </label>
                <input
                  type="text" placeholder="cth: Gudang untuk produk kering"
                  value={wForm.description}
                  onChange={e => setWForm(f => ({ ...f, description: e.target.value }))}
                  className="input text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2.5 pt-1">
              <button onClick={() => setShowWForm(false)} className="btn-ghost flex-1 py-2.5 text-sm justify-center">
                Batal
              </button>
              <button
                onClick={saveWarehouse}
                disabled={savingW || !wForm.name.trim()}
                className="btn-primary flex-1 py-2.5 text-sm justify-center"
              >
                {savingW && <Loader2 size={14} className="animate-spin" />}
                {editWarehouse ? 'Simpan Perubahan' : 'Tambah Gudang'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW — Stok per Gudang
  // ══════════════════════════════════════════════════════════════════════════

  const pal        = CARD_COLORS[selectedIdx % CARD_COLORS.length];
  const totalStock = stocks.reduce((s, x) => s + x.stockQty, 0);
  const lowStock   = stocks.filter(x => x.stockQty < 10).length;

  return (
    <div className="animate-fade-up">

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div
        className="px-6 pt-7 pb-6"
        style={{ background: pal.bg, borderBottom: '1px solid rgba(0,0,0,0.08)' }}
      >
        {/* Back + title */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={backToWarehouses}
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
            style={{ background: 'rgba(255,255,255,0.2)', color: pal.icon }}
            title="Kembali"
          >
            <ArrowLeft size={15} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold truncate" style={{ color: pal.icon }}>
              {selectedWarehouse?.name}
            </h1>
            {selectedWarehouse?.location && (
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin size={10} style={{ color: 'rgba(255,255,255,0.6)' }} />
                <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {selectedWarehouse.location}
                </p>
              </div>
            )}
          </div>
          <button
            onClick={() => selectedWarehouse && loadStock(selectedWarehouse.id)}
            className="ml-auto w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.2)', color: pal.icon }}
          >
            <RefreshCw size={13} className={stockLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Jenis Produk',     val: stocks.length, sub: 'terdaftar' },
            { label: 'Total Unit',       val: totalStock,    sub: 'semua produk' },
            { label: 'Stok Rendah',      val: lowStock,      sub: '< 10 unit' },
          ].map((s, i) => (
            <div key={i} className="rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,0.15)' }}>
              <p className="text-xl font-extrabold tabular" style={{ color: pal.icon }}>{s.val}</p>
              <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>{s.label}</p>
              <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Product stock list ───────────────────────────────────── */}
      <div className="p-4 lg:p-6">
        {stockLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
          </div>

        ) : stocks.length === 0 ? (
          <div
            className="rounded-3xl p-12 text-center"
            style={{ background: 'var(--surface)', border: '2px dashed var(--border)' }}
          >
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'var(--accent-bg)' }}>
              <Package size={28} style={{ color: 'var(--accent)' }} />
            </div>
            <p className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Belum ada produk
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Tambahkan produk di tab Produk terlebih dahulu.
            </p>
          </div>

        ) : (

          /* 2-column grid on desktop */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {stocks.map(s => (
              <div key={s.productId} className="card overflow-hidden">

                {/* Product header row */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div
                    className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-lg"
                    style={{ background: 'var(--accent-bg)' }}
                  >
                    📦
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {s.productName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`badge ${s.stockQty === 0 ? 'badge-red' : s.stockQty < 10 ? 'badge-amber' : 'badge-green'}`}
                      >
                        {s.stockQty} unit
                      </span>
                      {s.stockQty === 0 && (
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>Habis!</span>
                      )}
                      {s.stockQty > 0 && s.stockQty < 10 && (
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--warning)' }}>Stok rendah</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        setShowForm(showForm === s.productId ? null : s.productId);
                        setForm({ type: 'in', qty: '', note: '' });
                      }}
                      className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1"
                    >
                      <Plus size={11} /> Catat
                    </button>
                    <button onClick={() => toggleExpand(s.productId)} className="btn-ghost p-2">
                      {expandedId === s.productId
                        ? <ChevronUp size={13} />
                        : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* Catat stok form */}
                {showForm === s.productId && (
                  <div
                    className="px-4 pb-4 pt-3"
                    style={{ background: 'var(--accent-bg)', borderTop: '1px solid var(--border-2)' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                        Catat Pergerakan Stok
                      </p>
                      <button onClick={() => setShowForm(null)} className="btn-ghost p-1.5">
                        <X size={11} />
                      </button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        value={form.type}
                        onChange={e => setForm(f => ({ ...f, type: e.target.value as 'in' | 'out' }))}
                        className="input text-xs py-2"
                        style={{ flex: '0 0 auto', minWidth: 100 }}
                      >
                        <option value="in">✅ Masuk</option>
                        <option value="out">📤 Keluar</option>
                      </select>
                      <input
                        type="number" min={1} placeholder="Jumlah unit"
                        value={form.qty}
                        onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                        className="input text-xs py-2 flex-1"
                      />
                      <input
                        type="text" placeholder="Keterangan (opsional)"
                        value={form.note}
                        onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                        className="input text-xs py-2 flex-1"
                      />
                      <button
                        onClick={() => submitEntry(s.productId, s.productName)}
                        disabled={submitting || !form.qty}
                        className="btn-primary px-4 py-2 text-xs flex-shrink-0"
                      >
                        {submitting ? <Loader2 size={12} className="animate-spin" /> : 'Simpan'}
                      </button>
                    </div>
                  </div>
                )}

                {/* History */}
                {expandedId === s.productId && (
                  <div
                    className="px-4 pb-4 pt-3"
                    style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}
                  >
                    <p
                      className="text-[10px] font-bold uppercase tracking-widest mb-3"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Riwayat Pergerakan
                    </p>
                    {!s.entries ? (
                      <div className="flex justify-center py-4">
                        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
                      </div>
                    ) : s.entries.length === 0 ? (
                      <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>
                        Belum ada catatan.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {s.entries.map(e => (
                          <div key={e.id} className="flex items-center gap-3">
                            <div
                              className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 text-xs`}
                              style={{
                                background: e.type === 'in' ? 'var(--success-bg)' : 'var(--danger-bg)',
                              }}
                            >
                              {e.type === 'in'
                                ? <TrendingUp  size={12} style={{ color: 'var(--success)' }} />
                                : <TrendingDown size={12} style={{ color: 'var(--danger)' }} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span
                                className="text-xs font-bold"
                                style={{ color: e.type === 'in' ? 'var(--success)' : 'var(--danger)' }}
                              >
                                {e.type === 'in' ? '+' : '–'}{e.qty} unit
                              </span>
                              {e.note && (
                                <span className="text-xs ml-2 truncate" style={{ color: 'var(--text-muted)' }}>
                                  {e.note}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] tabular flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                              {formatDate(e)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

        )}
      </div>
    </div>
  );
}
