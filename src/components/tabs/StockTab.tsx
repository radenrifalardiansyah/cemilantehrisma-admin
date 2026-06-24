'use client';

import { useState, useEffect } from 'react';
import {
  Loader2, RefreshCw, Plus, TrendingUp, TrendingDown, Warehouse,
  ChevronDown, ChevronUp, X, ArrowLeft, Pencil, Trash2, MapPin,
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

export default function StockTab({ creds }: { creds: string }) {
  const [view, setView]                           = useState<'warehouses' | 'stock'>('warehouses');
  const [warehouses, setWarehouses]               = useState<WarehouseData[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseData | null>(null);
  const [stocks, setStocks]                       = useState<ProductStock[]>([]);
  const [loading, setLoading]                     = useState(true);
  const [stockLoading, setStockLoading]           = useState(false);

  // Warehouse form
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [editWarehouse, setEditWarehouse]         = useState<WarehouseData | null>(null);
  const [wForm, setWForm]                         = useState({ name: '', location: '', description: '' });
  const [savingW, setSavingW]                     = useState(false);
  const [deletingId, setDeletingId]               = useState<string | null>(null);

  // Stock entry form
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm]     = useState<string | null>(null);
  const [form, setForm]             = useState({ type: 'in' as 'in' | 'out', qty: '', note: '' });
  const [submitting, setSubmitting] = useState(false);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  // ── Data loaders ──────────────────────────────────────────────────────────

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

  // ── Warehouse CRUD ────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditWarehouse(null);
    setWForm({ name: '', location: '', description: '' });
    setShowWarehouseForm(true);
  };

  const openEdit = (w: WarehouseData, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditWarehouse(w);
    setWForm({ name: w.name, location: w.location, description: w.description });
    setShowWarehouseForm(true);
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
    setShowWarehouseForm(false);
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

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: Daftar Gudang
  // ══════════════════════════════════════════════════════════════════════════

  if (view === 'warehouses') return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Manajemen Gudang</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Kelola gudang dan stok produk per lokasi</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadWarehouses} className="btn-ghost p-2.5">
            <RefreshCw size={14} />
          </button>
          <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm">
            <Plus size={14} /> Tambah Gudang
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            <Warehouse size={16} />
          </div>
          <p className="text-xl font-extrabold tabular" style={{ color: 'var(--accent)' }}>{warehouses.length}</p>
          <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>Total Gudang</p>
        </div>
        <div className="card p-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
            style={{ background: 'var(--accent-bg)', color: 'var(--text-muted)' }}>
            <TrendingUp size={16} />
          </div>
          <p className="text-sm font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
            Pilih gudang untuk lihat stok
          </p>
        </div>
      </div>

      {/* Warehouse list */}
      {warehouses.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🏭</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada gudang</p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            Tambahkan gudang pertama untuk mulai mengelola stok per lokasi.
          </p>
          <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm mx-auto">
            <Plus size={14} /> Tambah Gudang
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
          {warehouses.map(w => (
            <div
              key={w.id}
              className="flex items-center gap-3 px-4 py-4 cursor-pointer transition-colors"
              style={{ background: 'transparent' }}
              onClick={() => openWarehouse(w)}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
                style={{ background: 'var(--accent-bg)' }}>
                <Warehouse size={18} style={{ color: 'var(--accent)' }} />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{w.name}</p>
                {w.location && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin size={10} style={{ color: 'var(--text-muted)' }} />
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{w.location}</p>
                  </div>
                )}
                {w.description && (
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{w.description}</p>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={e => openEdit(w, e)}
                  className="btn-ghost p-2"
                  title="Edit gudang"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={e => deleteWarehouse(w.id, e)}
                  disabled={deletingId === w.id}
                  className="btn-ghost p-2"
                  style={{ color: 'var(--danger)' }}
                  title="Hapus gudang"
                >
                  {deletingId === w.id
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Trash2 size={13} />}
                </button>
                <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Create / Edit Gudang */}
      {showWarehouseForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowWarehouseForm(false); }}
        >
          <div className="card w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {editWarehouse ? 'Edit Gudang' : 'Tambah Gudang Baru'}
              </h3>
              <button onClick={() => setShowWarehouseForm(false)} className="btn-ghost p-1">
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Nama Gudang <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text" placeholder="cth: Gudang Utama"
                  value={wForm.name}
                  onChange={e => setWForm(f => ({ ...f, name: e.target.value }))}
                  className="input text-sm w-full"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Lokasi
                </label>
                <input
                  type="text" placeholder="cth: Jl. Mawar No. 5, Malang"
                  value={wForm.location}
                  onChange={e => setWForm(f => ({ ...f, location: e.target.value }))}
                  className="input text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Keterangan
                </label>
                <input
                  type="text" placeholder="opsional"
                  value={wForm.description}
                  onChange={e => setWForm(f => ({ ...f, description: e.target.value }))}
                  className="input text-sm w-full"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowWarehouseForm(false)} className="btn-ghost px-4 py-2 text-sm">
                Batal
              </button>
              <button
                onClick={saveWarehouse}
                disabled={savingW || !wForm.name.trim()}
                className="btn-primary px-4 py-2 text-sm flex items-center gap-1.5"
              >
                {savingW && <Loader2 size={14} className="animate-spin" />}
                {editWarehouse ? 'Simpan' : 'Tambah'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: Stok Produk per Gudang
  // ══════════════════════════════════════════════════════════════════════════

  const totalStock = stocks.reduce((s, x) => s + x.stockQty, 0);
  const lowStock   = stocks.filter(x => x.stockQty < 10).length;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={backToWarehouses} className="btn-ghost p-2" title="Kembali ke daftar gudang">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>
              {selectedWarehouse?.name}
            </h2>
            {selectedWarehouse?.location && (
              <div className="flex items-center gap-1">
                <MapPin size={10} style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{selectedWarehouse.location}</p>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => selectedWarehouse && loadStock(selectedWarehouse.id)}
          className="btn-ghost p-2.5"
        >
          <RefreshCw size={14} className={stockLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <Warehouse size={16} />,    label: 'Jenis Produk',      val: stocks.length, color: 'var(--accent)' },
          { icon: <TrendingUp size={16} />,   label: 'Total Stok',        val: totalStock,    color: 'var(--success)' },
          { icon: <TrendingDown size={16} />, label: 'Stok Rendah (<10)', val: lowStock,      color: 'var(--danger)' },
        ].map((c, i) => (
          <div key={i} className="card p-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
              style={{ background: 'var(--accent-bg)', color: c.color }}>
              {c.icon}
            </div>
            <p className="text-xl font-extrabold tabular" style={{ color: c.color }}>{c.val}</p>
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
          </div>
        ))}
      </div>

      {/* Stock list */}
      {stockLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : stocks.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">📦</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada produk</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Tambahkan produk terlebih dahulu di tab Produk.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
          {stocks.map(s => (
            <div key={s.productId}>

              {/* Product row */}
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'var(--accent-bg)' }}>
                  <Warehouse size={16} style={{ color: 'var(--accent)' }} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {s.productName}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`badge ${s.stockQty < 10 ? 'badge-red' : s.stockQty < 30 ? 'badge-amber' : 'badge-green'}`}>
                      {s.stockQty} unit
                    </span>
                    {s.stockQty < 10 && (
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>
                        Stok rendah!
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => {
                      setShowForm(showForm === s.productId ? null : s.productId);
                      setForm({ type: 'in', qty: '', note: '' });
                    }}
                    className="btn-primary flex items-center gap-1 px-3 py-2 text-xs"
                  >
                    <Plus size={12} /> Catat
                  </button>
                  <button onClick={() => toggleExpand(s.productId)} className="btn-ghost p-2">
                    {expandedId === s.productId ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>
              </div>

              {/* Form catat stok */}
              {showForm === s.productId && (
                <div
                  className="px-4 pb-4 pt-3"
                  style={{ background: 'var(--accent-bg)', borderTop: '1px solid var(--border-2)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                      Catat Pergerakan Stok
                    </p>
                    <button onClick={() => setShowForm(null)} className="btn-ghost p-1"><X size={12} /></button>
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
                      className="btn-primary px-4 text-xs py-2 flex-shrink-0"
                    >
                      {submitting ? <Loader2 size={12} className="animate-spin" /> : 'Simpan'}
                    </button>
                  </div>
                </div>
              )}

              {/* Riwayat pergerakan */}
              {expandedId === s.productId && (
                <div
                  className="px-4 pb-4 pt-3"
                  style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-2.5"
                    style={{ color: 'var(--text-muted)' }}>
                    Riwayat Pergerakan
                  </p>
                  {!s.entries ? (
                    <div className="flex justify-center py-4">
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
                    </div>
                  ) : s.entries.length === 0 ? (
                    <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>
                      Belum ada catatan pergerakan.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {s.entries.map(e => (
                        <div key={e.id} className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${e.type === 'in' ? 'bg-green-50' : 'bg-red-50'}`}>
                            {e.type === 'in'
                              ? <TrendingUp  size={11} style={{ color: 'var(--success)' }} />
                              : <TrendingDown size={11} style={{ color: 'var(--danger)' }} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-semibold"
                              style={{ color: e.type === 'in' ? 'var(--success)' : 'var(--danger)' }}>
                              {e.type === 'in' ? '+' : '–'}{e.qty} unit
                            </span>
                            {e.note && (
                              <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
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
