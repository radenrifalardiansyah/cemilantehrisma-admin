'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2, RefreshCw, Plus, TrendingUp, TrendingDown, Warehouse,
  X, ArrowLeft, Pencil, Trash2, MapPin,
  ChevronRight, Package, Clock,
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

// ── CatatModal ────────────────────────────────────────────────────────────────
type CatatForm = { type: 'in' | 'out'; qty: string; note: string };

function CatatModal({ productName, form, onChange, onClose, onSave, submitting }: {
  productName: string; form: CatatForm;
  onChange: (f: CatatForm) => void;
  onClose: () => void; onSave: () => void; submitting: boolean;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Package size={17} /></div>
            <div>
              <p className="modal-title">Catat Pergerakan Stok</p>
              <p className="modal-subtitle">{productName}</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Masuk / Keluar toggle */}
            <div>
              <label className="field-label">Jenis Pergerakan</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { val: 'in'  as const, label: 'Stok Masuk',  Icon: TrendingUp,   color: 'var(--success)', bg: 'var(--success-bg)', border: '#15803D' },
                  { val: 'out' as const, label: 'Stok Keluar', Icon: TrendingDown, color: 'var(--danger)',  bg: 'var(--danger-bg)',  border: '#DC2626' },
                ]).map(opt => (
                  <button key={opt.val} type="button"
                    onClick={() => onChange({ ...form, type: opt.val })}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '10px 12px', borderRadius: 10,
                      border: `1.5px solid ${form.type === opt.val ? opt.border : 'var(--border)'}`,
                      background: form.type === opt.val ? opt.bg : 'var(--surface-2)',
                      color: form.type === opt.val ? opt.color : 'var(--text-muted)',
                      fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <opt.Icon size={13} /> {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Qty */}
            <div>
              <label className="field-label">
                Jumlah Unit<span style={{ color: 'var(--danger)' }}> *</span>
              </label>
              <input
                type="number" min={1} placeholder="cth: 10"
                value={form.qty}
                onChange={e => onChange({ ...form, qty: e.target.value })}
                className="input"
                autoFocus
              />
            </div>

            {/* Note */}
            <div>
              <label className="field-label">Keterangan</label>
              <input
                type="text" placeholder="cth: Restock dari supplier (opsional)"
                value={form.note}
                onChange={e => onChange({ ...form, note: e.target.value })}
                className="input"
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Batal
          </button>
          <button onClick={onSave} disabled={submitting || !form.qty || Number(form.qty) <= 0}
            className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Simpan Catatan
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── RiwayatModal ──────────────────────────────────────────────────────────────
function RiwayatModal({ stock, onClose }: { stock: ProductStock; onClose: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Clock size={17} /></div>
            <div>
              <p className="modal-title">Riwayat Pergerakan</p>
              <p className="modal-subtitle">{stock.productName}</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>
        <div className="modal-body">
          {!stock.entries ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : stock.entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Clock size={28} style={{ color: 'var(--text-muted)', margin: '0 auto 12px', display: 'block' }} />
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Belum ada catatan pergerakan</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stock.entries.map(e => (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 10,
                  background: 'var(--surface-2)', border: '1px solid var(--border-2)',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: e.type === 'in' ? 'var(--success-bg)' : 'var(--danger-bg)',
                  }}>
                    {e.type === 'in'
                      ? <TrendingUp  size={14} style={{ color: 'var(--success)' }} />
                      : <TrendingDown size={14} style={{ color: 'var(--danger)' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: e.type === 'in' ? 'var(--success)' : 'var(--danger)' }}>
                      {e.type === 'in' ? '+' : '–'}{e.qty} unit
                    </p>
                    {e.note && (
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.note}
                      </p>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {formatDate(e)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function StockTab({
  creds,
  products = [],
}: {
  creds: string;
  products?: { id: string; name: string; emoji: string; bgColor: string }[];
}) {
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

  // Catat modal
  const [catatTarget, setCatatTarget] = useState<{ productId: string; productName: string } | null>(null);
  const [catatForm, setCatatForm]     = useState<CatatForm>({ type: 'in', qty: '', note: '' });
  const [submitting, setSubmitting]   = useState(false);

  // Riwayat modal
  const [riwayatId, setRiwayatId] = useState<string | null>(null);
  const riwayatStock = riwayatId ? (stocks.find(s => s.productId === riwayatId) ?? null) : null;

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
    setRiwayatId(null);
    setCatatTarget(null);
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

  const openCatat = (s: ProductStock) => {
    setCatatTarget({ productId: s.productId, productName: s.productName });
    setCatatForm({ type: 'in', qty: '', note: '' });
  };

  const openRiwayat = async (s: ProductStock) => {
    setRiwayatId(s.productId);
    if (selectedWarehouse && !s.entries) {
      await loadEntries(selectedWarehouse.id, s.productId);
    }
  };

  const submitCatat = async () => {
    if (!catatTarget || !catatForm.qty || Number(catatForm.qty) <= 0 || !selectedWarehouse) return;
    setSubmitting(true);
    const { productId, productName } = catatTarget;
    const r = await fetch(`${API}/api/warehouses/${selectedWarehouse.id}/stock`, {
      method: 'POST', headers,
      body: JSON.stringify({ productId, productName, type: catatForm.type, qty: Number(catatForm.qty), note: catatForm.note }),
    });
    if (r.ok) {
      setCatatTarget(null);
      await loadStock(selectedWarehouse.id);
      if (riwayatId === productId) await loadEntries(selectedWarehouse.id, productId);
    }
    setSubmitting(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  // VIEW — Daftar Gudang
  // ════════════════════════════════════════════════════════════════
  if (view === 'warehouses') return (
    <div className="p-4 lg:p-6 animate-fade-up">
      {/* Header */}
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
          { icon: <Warehouse size={16} />, label: 'Total Gudang', val: warehouses.length, color: 'var(--accent)'  },
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

      {/* Empty state */}
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

          {/* Add card */}
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
  );

  // ════════════════════════════════════════════════════════════════
  // VIEW — Stok per Gudang
  // ════════════════════════════════════════════════════════════════
  const totalStock = stocks.reduce((s, x) => s + x.stockQty, 0);
  const lowStock   = stocks.filter(x => x.stockQty < 10).length;

  return (
    <div className="p-4 lg:p-6 animate-fade-up">

      {/* Header */}
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

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: <Package       size={16} />, label: 'Jenis Produk', val: stocks.length, color: 'var(--accent)'  },
          { icon: <TrendingUp    size={16} />, label: 'Total Unit',   val: totalStock,    color: 'var(--success)' },
          { icon: <TrendingDown  size={16} />, label: 'Stok Rendah',  val: lowStock,      color: 'var(--danger)'  },
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

      {/* Product grid */}
      {stockLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : stocks.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-bg)' }}>
            <Package size={24} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada produk</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tambahkan produk di tab Produk terlebih dahulu.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {stocks.map(s => {
            const prod    = products.find(p => p.name === s.productName);
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
                {/* Emoji area */}
                <div className="relative w-full aspect-square" style={{ background: `${bgColor}22` }}>
                  <div className="absolute inset-0 flex items-center justify-center text-4xl">{emoji}</div>
                  {/* Stock qty overlay badge */}
                  <div className="absolute top-2 right-2 text-[10px] font-black px-2 py-0.5 rounded-full"
                    style={{ background: qtyStyle.bg, color: qtyStyle.color, border: `1px solid ${qtyStyle.border}` }}>
                    {qty} unit
                  </div>
                </div>

                {/* Info + buttons */}
                <div className="px-3 pt-2 pb-3 flex flex-col flex-1">
                  <p className="text-[11px] font-bold leading-snug line-clamp-2 flex-1 mb-2"
                    style={{ color: 'var(--text-primary)' }}>
                    {s.productName}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => openCatat(s)}
                      className="btn-primary flex-1 text-xs py-1.5 justify-center">
                      <Plus size={11} /> Catat
                    </button>
                    <button onClick={() => openRiwayat(s)}
                      className="btn-ghost p-1.5" title="Riwayat Pergerakan">
                      <Clock size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Catat modal */}
      {catatTarget && (
        <CatatModal
          productName={catatTarget.productName}
          form={catatForm}
          onChange={setCatatForm}
          onClose={() => setCatatTarget(null)}
          onSave={submitCatat}
          submitting={submitting}
        />
      )}

      {/* Riwayat modal */}
      {riwayatStock && (
        <RiwayatModal stock={riwayatStock} onClose={() => setRiwayatId(null)} />
      )}
    </div>
  );
}
