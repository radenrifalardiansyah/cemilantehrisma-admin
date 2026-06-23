'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Plus, TrendingUp, TrendingDown, Warehouse, ChevronDown, ChevronUp, X } from 'lucide-react';

const API = '';

interface StockEntry {
  id: string; type: 'in' | 'out'; qty: number; note: string;
  createdAt?: { seconds: number };
}
interface ProductStock {
  productId: string; productName: string; stockQty: number;
  entries?: StockEntry[];
}

function formatDate(e: StockEntry) {
  if (e.createdAt?.seconds)
    return new Date(e.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return '–';
}

export default function StockTab({ creds }: { creds: string }) {
  const [stocks,      setStocks]     = useState<ProductStock[]>([]);
  const [loading,     setLoading]    = useState(true);
  const [expandedId,  setExpandedId] = useState<string | null>(null);
  const [showForm,    setShowForm]   = useState<string | null>(null);
  const [form,        setForm]       = useState({ type: 'in' as 'in' | 'out', qty: '', note: '' });
  const [submitting,  setSubmitting] = useState(false);

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/stock`, { headers });
    if (r.ok) { const { stocks: s } = await r.json() as { stocks: ProductStock[] }; setStocks(s); }
    setLoading(false);
  };

  const loadEntries = async (productId: string) => {
    const r = await fetch(`${API}/api/stock/${productId}`, { headers });
    if (r.ok) {
      const { entries } = await r.json() as { entries: StockEntry[] };
      setStocks(s => s.map(x => x.productId === productId ? { ...x, entries } : x));
    }
  };

  const toggleExpand = async (productId: string) => {
    if (expandedId === productId) { setExpandedId(null); return; }
    setExpandedId(productId);
    await loadEntries(productId);
  };

  useEffect(() => { load(); }, []);

  const submitEntry = async (productId: string) => {
    if (!form.qty || Number(form.qty) <= 0) return;
    setSubmitting(true);
    const r = await fetch(`${API}/api/stock/${productId}`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: form.type, qty: Number(form.qty), note: form.note }),
    });
    if (r.ok) {
      setForm({ type: 'in', qty: '', note: '' });
      setShowForm(null);
      await load();
      if (expandedId === productId) await loadEntries(productId);
    }
    setSubmitting(false);
  };

  const totalIn  = stocks.reduce((s, x) => s + (x.stockQty > 0 ? x.stockQty : 0), 0);
  const lowStock = stocks.filter(x => x.stockQty < 10).length;

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Gudang</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Kelola stok masuk dan keluar</p>
        </div>
        <button onClick={load} className="btn-ghost p-2.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <Warehouse    size={16}/>, label: 'Produk Terdaftar', val: stocks.length,  color: 'var(--accent)' },
          { icon: <TrendingUp   size={16}/>, label: 'Total Stok',       val: totalIn,         color: 'var(--success)' },
          { icon: <TrendingDown size={16}/>, label: 'Stok Rendah (<10)',val: lowStock,         color: 'var(--danger)' },
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
      {stocks.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">📦</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada data stok</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Stok produk akan muncul otomatis dari daftar produk.</p>
        </div>
      ) : (
        <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
          {stocks.map(s => (
            <div key={s.productId}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'var(--accent-bg)' }}>
                  <Warehouse size={16} style={{ color: 'var(--accent)' }} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.productName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`badge ${s.stockQty < 10 ? 'badge-red' : s.stockQty < 30 ? 'badge-amber' : 'badge-green'}`}
                    >
                      {s.stockQty} unit
                    </span>
                    {s.stockQty < 10 && (
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>Stok rendah!</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { setShowForm(showForm === s.productId ? null : s.productId); setForm({ type: 'in', qty: '', note: '' }); }}
                    className="btn-primary flex items-center gap-1 px-3 py-2 text-xs"
                  >
                    <Plus size={12} /> Catat
                  </button>
                  <button onClick={() => toggleExpand(s.productId)} className="btn-ghost p-2">
                    {expandedId === s.productId ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>
              </div>

              {/* Add entry form */}
              {showForm === s.productId && (
                <div className="px-4 pb-4 pt-3" style={{ background: 'var(--accent-bg)', borderTop: '1px solid var(--border-2)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Catat Pergerakan Stok</p>
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
                      onClick={() => submitEntry(s.productId)}
                      disabled={submitting || !form.qty}
                      className="btn-primary px-4 text-xs py-2 flex-shrink-0"
                    >
                      {submitting ? <Loader2 size={12} className="animate-spin" /> : 'Simpan'}
                    </button>
                  </div>
                </div>
              )}

              {/* History */}
              {expandedId === s.productId && (
                <div className="px-4 pb-4 pt-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-muted)' }}>Riwayat Pergerakan</p>
                  {!s.entries ? (
                    <div className="flex justify-center py-4">
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
                    </div>
                  ) : s.entries.length === 0 ? (
                    <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>Belum ada catatan pergerakan.</p>
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
                            <span className="text-xs font-semibold" style={{ color: e.type === 'in' ? 'var(--success)' : 'var(--danger)' }}>
                              {e.type === 'in' ? '+' : '–'}{e.qty} unit
                            </span>
                            {e.note && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{e.note}</span>}
                          </div>
                          <span className="text-[10px] tabular flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(e)}</span>
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
