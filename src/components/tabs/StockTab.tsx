'use client';

import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Plus, TrendingUp, TrendingDown, Warehouse } from 'lucide-react';

const API = '';

interface FireProduct { id: string; name: string; emoji: string; bgColor: string; weight: string; stockQty?: number; stock: string; }
interface StockEntry { id: string; productId: string; type: 'in' | 'out'; qty: number; note: string; date: string; createdAt?: { seconds: number }; }

const formatRp = (n: number) => new Intl.NumberFormat('id-ID').format(n);

export default function StockTab({ creds }: { creds: string }) {
  const [products, setProducts] = useState<FireProduct[]>([]);
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ productId: '', type: 'in' as 'in' | 'out', qty: '', note: '', date: new Date().toISOString().slice(0, 10) });

  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const load = async () => {
    setLoading(true);
    const [pr, sr] = await Promise.all([
      fetch(`${API}/api/products`, { headers }),
      fetch(`${API}/api/stock`, { headers }),
    ]);
    if (pr.ok) { const { products: p } = await pr.json() as { products: FireProduct[] }; setProducts(p); }
    if (sr.ok) { const { entries: e } = await sr.json() as { entries: StockEntry[] }; setEntries(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.productId || !form.qty) return;
    setSaving(true);
    await fetch(`${API}/api/stock/${form.productId}`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: form.type, qty: parseInt(form.qty), note: form.note, date: form.date }),
    });
    setForm({ productId: '', type: 'in', qty: '', note: '', date: new Date().toISOString().slice(0, 10) });
    setShowForm(false);
    await load();
    setSaving(false);
  };

  const formatDate = (e: StockEntry) => {
    if (e.createdAt?.seconds) {
      return new Date(e.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    }
    return e.date ?? '–';
  };

  const productMap = Object.fromEntries(products.map(p => [p.id, p]));

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-amber-400" /></div>;

  return (
    <div className="px-4 py-5 pb-10 space-y-4 max-w-2xl mx-auto w-full">

      {/* Stok ringkasan per produk */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800">Stok Saat Ini</p>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200"><RefreshCw size={14} /></button>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white shadow-md"
            style={{ background: 'linear-gradient(135deg,#D97706,#EA580C)' }}>
            <Plus size={13} /> Catat Stok
          </button>
        </div>
      </div>

      {/* Form catat stok */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm p-4 space-y-3">
          <p className="text-sm font-bold text-gray-700 flex items-center gap-2"><Warehouse size={15} className="text-amber-500" /> Catat Pergerakan Stok</p>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setForm(f => ({ ...f, type: 'in' }))}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all border ${form.type === 'in' ? 'text-white border-transparent' : 'text-gray-500 bg-white border-gray-200'}`}
              style={form.type === 'in' ? { background: 'linear-gradient(135deg,#16A34A,#22C55E)' } : {}}>
              <TrendingUp size={13} /> Stok Masuk
            </button>
            <button onClick={() => setForm(f => ({ ...f, type: 'out' }))}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all border ${form.type === 'out' ? 'text-white border-transparent' : 'text-gray-500 bg-white border-gray-200'}`}
              style={form.type === 'out' ? { background: 'linear-gradient(135deg,#DC2626,#EF4444)' } : {}}>
              <TrendingDown size={13} /> Stok Keluar
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Produk</label>
            <select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50">
              <option value="">Pilih produk...</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name} ({p.weight})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Jumlah (pcs)</label>
              <input type="number" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-amber-400 bg-gray-50" placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Tanggal</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-amber-400 bg-gray-50" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Catatan (opsional)</label>
            <input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-amber-400 bg-gray-50"
              placeholder="Mis: batch produksi 23 Juni" />
          </div>

          <button onClick={save} disabled={saving || !form.productId || !form.qty}
            className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: form.type === 'in' ? 'linear-gradient(135deg,#16A34A,#22C55E)' : 'linear-gradient(135deg,#DC2626,#EF4444)' }}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Menyimpan...' : `Simpan Stok ${form.type === 'in' ? 'Masuk' : 'Keluar'}`}
          </button>
        </div>
      )}

      {/* Stok per produk */}
      {products.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Saldo Stok per Produk</p>
          </div>
          <div className="divide-y divide-gray-50">
            {products.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: `${p.bgColor}22` }}>{p.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.weight}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${(p.stockQty ?? 0) > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {formatRp(p.stockQty ?? 0)} pcs
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Riwayat pergerakan */}
      <p className="text-sm font-bold text-gray-800">Riwayat Pergerakan</p>
      {entries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-amber-200 p-8 text-center">
          <div className="text-3xl mb-2">📊</div>
          <p className="text-sm text-gray-500">Belum ada catatan stok</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
          {entries.slice(0, 50).map(e => {
            const p = productMap[e.productId];
            return (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${e.type === 'in' ? 'bg-green-50' : 'bg-red-50'}`}>
                  {e.type === 'in' ? <TrendingUp size={15} className="text-green-500" /> : <TrendingDown size={15} className="text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{p ? `${p.emoji} ${p.name}` : e.productId}</p>
                  {e.note && <p className="text-xs text-gray-400 truncate">{e.note}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${e.type === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                    {e.type === 'in' ? '+' : '−'}{formatRp(e.qty)} pcs
                  </p>
                  <p className="text-[10px] text-gray-400">{formatDate(e)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
