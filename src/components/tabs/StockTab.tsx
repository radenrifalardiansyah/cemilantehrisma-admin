'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

// ── Warehouse modal (portal → document.body) ─────────────────────────────────
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
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />

        {/* Header */}
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

        {/* Fields */}
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

        {/* Actions */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Batal
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="btn-primary"
            style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function StockTab({ creds }: { creds: string }) {
  const [view, setView]                           = useState<'warehouses' | 'stock'>('warehouses');
  const [warehouses, setWarehouses]               = useState<WarehouseData[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseData | null>(null);
  const [stocks, setStocks]                       = useState<ProductStock[]>([]);
  const [loading, setLoading]                     = useState(true);
  const [stockLoading, setStockLoading]           = useState(false);

  // Warehouse form
  const [showWForm, setShowWForm]         = useState(false);
  const [editWarehouse, setEditWarehouse] = useState<WarehouseData | null>(null);
  const [wForm, setWForm]                 = useState({ name: '', location: '', description: '' });
  const [savingW, setSavingW]             = useState(false);
  const [deletingId, setDeletingId]       = useState<string | null>(null);
  const [hoveredCard, setHoveredCard]     = useState<string | null>(null);

  // Stock entry form
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm]     = useState<string | null>(null);
  const [form, setForm]             = useState({ type: 'in' as 'in' | 'out', qty: '', note: '' });
  const [submitting, setSubmitting] = useState(false);

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

  const openWarehouse = async (w: WarehouseData) => {
    setSelectedWarehouse(w);
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
      body: JSON.stringify({ productId, productName, type: form.type, qty: Number(form.qty), note: form.note }),
    });
    if (r.ok) {
      setForm({ type: 'in', qty: '', note: '' });
      setShowForm(null);
      await loadStock(selectedWarehouse.id);
      if (expandedId === productId) await loadEntries(selectedWarehouse.id, productId);
    }
    setSubmitting(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW — Daftar Gudang
  // ══════════════════════════════════════════════════════════════════════════

  if (view === 'warehouses') return (
    <div className="p-4 lg:p-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>
            Manajemen Gudang
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {warehouses.length} gudang terdaftar
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadWarehouses} className="btn-ghost p-2.5" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { icon: <Warehouse size={16} />, label: 'Total Gudang',      val: warehouses.length,                              color: 'var(--accent)'   },
          { icon: <Package   size={16} />, label: 'Aktif',             val: warehouses.length,                              color: 'var(--success)'  },
        ].map((c, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-bg)', color: c.color }}
            >
              {c.icon}
            </div>
            <div>
              <p className="text-xl font-extrabold tabular leading-none" style={{ color: c.color }}>{c.val}</p>
              <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {warehouses.length === 0 ? (
        <div
          className="rounded-2xl p-16 text-center"
          style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--accent-bg)' }}
          >
            <Warehouse size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada gudang</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            Tambahkan gudang untuk mulai mengelola stok per lokasi
          </p>
          <button onClick={openCreate} className="btn-primary mx-auto px-5 py-2.5 text-sm">
            <Plus size={14} /> Tambah Gudang Pertama
          </button>
        </div>

      ) : (

        /* Warehouse grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {warehouses.map(w => (
            <div
              key={w.id}
              onClick={() => openWarehouse(w)}
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
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center"
                    style={{ background: 'var(--accent-bg)' }}
                  >
                    <Warehouse size={20} style={{ color: 'var(--accent)' }} />
                  </div>

                  {/* Edit / Delete — visible on hover */}
                  <div
                    className="flex items-center gap-1"
                    style={{ opacity: hoveredCard === w.id ? 1 : 0, transition: 'opacity 0.15s' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      onClick={e => openEdit(w, e)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={e => deleteWarehouse(w.id, e)}
                      disabled={deletingId === w.id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
                      title="Hapus"
                    >
                      {deletingId === w.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>

                <p className="font-bold text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
                  {w.name}
                </p>

                {w.location ? (
                  <div className="flex items-center gap-1 mt-1.5">
                    <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{w.location}</p>
                  </div>
                ) : (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Tidak ada lokasi</p>
                )}

                {w.description && (
                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
                    {w.description}
                  </p>
                )}

                <div
                  className="flex items-center justify-between mt-4 pt-3.5"
                  style={{ borderTop: '1px solid var(--border-2)' }}
                >
                  <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                    Lihat Stok
                  </span>
                  <ChevronRight size={14} style={{ color: 'var(--accent)' }} />
                </div>
              </div>
            </div>
          ))}

          {/* Add card */}
          <button
            onClick={openCreate}
            className="rounded-2xl flex flex-col items-center justify-center gap-2.5 p-6 min-h-[160px] transition-colors"
            style={{ border: '2px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = 'var(--surface-2)';
              el.style.borderColor = 'var(--accent)';
              el.style.color = 'var(--accent)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = 'transparent';
              el.style.borderColor = 'var(--border)';
              el.style.color = 'var(--text-muted)';
            }}
          >
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-2)' }}>
              <Plus size={20} />
            </div>
            <span className="text-sm font-semibold">Tambah Gudang</span>
          </button>
        </div>
      )}

      {/* Modal — di-portal ke document.body agar overlay cover full viewport */}
      {showWForm && <WarehouseModal
        title={editWarehouse ? 'Edit Gudang' : 'Tambah Gudang Baru'}
        subtitle={editWarehouse ? 'Perbarui informasi gudang' : 'Isi detail gudang baru'}
        form={wForm}
        saving={savingW}
        onChange={setWForm}
        onClose={() => setShowWForm(false)}
        onSave={saveWarehouse}
        submitLabel={editWarehouse ? 'Simpan Perubahan' : 'Tambah Gudang'}
      />}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW — Stok per Gudang
  // ══════════════════════════════════════════════════════════════════════════

  const totalStock = stocks.reduce((s, x) => s + x.stockQty, 0);
  const lowStock   = stocks.filter(x => x.stockQty < 10).length;

  return (
    <div className="p-4 lg:p-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={backToWarehouses}
          className="btn-ghost p-2 flex-shrink-0"
          title="Kembali ke daftar gudang"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-extrabold truncate" style={{ color: 'var(--text-primary)' }}>
            {selectedWarehouse?.name}
          </h2>
          {selectedWarehouse?.location && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin size={10} style={{ color: 'var(--text-muted)' }} />
              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                {selectedWarehouse.location}
              </p>
            </div>
          )}
        </div>
        <button
          onClick={() => selectedWarehouse && loadStock(selectedWarehouse.id)}
          className="btn-ghost p-2.5 flex-shrink-0"
          title="Refresh"
        >
          <RefreshCw size={14} className={stockLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: <Package size={16} />,       label: 'Jenis Produk', val: stocks.length, color: 'var(--accent)'  },
          { icon: <TrendingUp size={16} />,    label: 'Total Unit',   val: totalStock,    color: 'var(--success)' },
          { icon: <TrendingDown size={16} />,  label: 'Stok Rendah',  val: lowStock,      color: 'var(--danger)'  },
        ].map((c, i) => (
          <div key={i} className="card p-4">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center mb-3"
              style={{ background: 'var(--accent-bg)', color: c.color }}
            >
              {c.icon}
            </div>
            <p className="text-xl font-extrabold tabular" style={{ color: c.color }}>{c.val}</p>
            <p className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
          </div>
        ))}
      </div>

      {/* Product list */}
      {stockLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>

      ) : stocks.length === 0 ? (
        <div
          className="rounded-2xl p-16 text-center"
          style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--accent-bg)' }}
          >
            <Package size={24} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada produk</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Tambahkan produk di tab Produk terlebih dahulu.
          </p>
        </div>

      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {stocks.map(s => (
            <div key={s.productId} className="card overflow-hidden">

              {/* Product row */}
              <div className="flex items-center gap-3 px-4 py-4">
                <div
                  className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'var(--accent-bg)' }}
                >
                  <Package size={17} style={{ color: 'var(--accent)' }} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {s.productName}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
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
                    {expandedId === s.productId ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
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
                      <option value="in">Masuk</option>
                      <option value="out">Keluar</option>
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

              {/* Riwayat */}
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
                            className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
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
  );
}
