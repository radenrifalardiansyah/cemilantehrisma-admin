'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Plus, Pencil, Trash2, X, Check, Loader2, ImagePlus,
  Package, ChevronDown, ChevronUp,
} from 'lucide-react';

const API = '';

interface FireProduct {
  id: string;
  name: string;
  description: string;
  details: string[];
  price: number;
  originalPrice?: number;
  emoji: string;
  imageUrls: string[];
  category: string;
  badge?: string;
  stock: string;
  gradient: string;
  bgColor: string;
  weight: string;
  stockQty?: number;
}

const EMPTY: Omit<FireProduct, 'id'> = {
  name: '', description: '', details: [''], price: 0, emoji: '🛍️',
  imageUrls: [], category: 'keripik', badge: '', stock: 'ready',
  gradient: 'from-amber-700 to-yellow-500', bgColor: '#B45309', weight: '', stockQty: 0,
};

const STOCK_LABELS: Record<string, string> = { ready: 'Tersedia', habis: 'Habis', open_po: 'Open PO' };
const BADGE_OPTS = ['', 'Best Seller', 'Popular', 'New'];
const CAT_OPTS = ['keripik', 'mie', 'snack', 'paket'];
const STOCK_OPTS = ['ready', 'habis', 'open_po'];
const formatRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

function stockBadge(s: string) {
  const map: Record<string, string> = {
    ready: 'bg-green-100 text-green-700',
    habis: 'bg-red-100 text-red-600',
    open_po: 'bg-amber-100 text-amber-700',
  };
  return map[s] ?? 'bg-gray-100 text-gray-500';
}

export default function ProductsTab({ creds }: { creds: string }) {
  const [products, setProducts] = useState<FireProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [editing, setEditing] = useState<FireProduct | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const headers = { 'x-admin-auth': creds };

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/products`, { headers });
    if (r.ok) { const { products: p } = await r.json() as { products: FireProduct[] }; setProducts(p); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const seed = async () => {
    if (!confirm('Migrasi 11 produk default ke Firestore? Produk yang sudah ada tidak akan ditimpa.')) return;
    setSeeding(true);
    const r = await fetch(`${API}/api/seed`, { method: 'POST', headers });
    if (r.ok) { const d = await r.json() as { seeded: number }; alert(`Berhasil: ${d.seeded} produk baru ditambahkan.`); await load(); }
    setSeeding(false);
  };

  const openNew = () => { setEditing({ id: '', ...EMPTY }); setIsNew(true); };
  const openEdit = (p: FireProduct) => { setEditing({ ...p }); setIsNew(false); };
  const closeEdit = () => { setEditing(null); setIsNew(false); };

  const handleDetailChange = (idx: number, val: string) => {
    if (!editing) return;
    const d = [...editing.details];
    d[idx] = val;
    setEditing({ ...editing, details: d });
  };
  const addDetail = () => editing && setEditing({ ...editing, details: [...editing.details, ''] });
  const removeDetail = (idx: number) => editing && setEditing({ ...editing, details: editing.details.filter((_, i) => i !== idx) });

  const uploadImage = async (file: File) => {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('folder', 'products');
    const r = await fetch(`${API}/api/upload`, { method: 'POST', headers, body: form });
    if (r.ok) {
      const { url } = await r.json() as { url: string };
      if (editing) setEditing({ ...editing, imageUrls: [...editing.imageUrls, url] });
    }
    setUploading(false);
  };

  const removeImage = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, imageUrls: editing.imageUrls.filter((_, i) => i !== idx) });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const { id, ...data } = editing;
    if (isNew) {
      await fetch(`${API}/api/products`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      await fetch(`${API}/api/products/${id}`, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    await load();
    closeEdit();
    setSaving(false);
  };

  const del = async (id: string, name: string) => {
    if (!confirm(`Hapus "${name}"?`)) return;
    await fetch(`${API}/api/products/${id}`, { method: 'DELETE', headers });
    setProducts(p => p.filter(x => x.id !== id));
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={28} className="animate-spin text-amber-400" />
    </div>
  );

  return (
    <div className="px-4 py-5 pb-10 space-y-4 max-w-2xl mx-auto w-full">

      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-gray-800">{products.length} Produk</p>
          <p className="text-xs text-gray-400">Data dari Firebase Firestore</p>
        </div>
        <div className="flex gap-2">
          {products.length === 0 && (
            <button onClick={seed} disabled={seeding}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-50">
              {seeding ? <Loader2 size={13} className="animate-spin" /> : <Package size={13} />}
              Migrasi Data
            </button>
          )}
          <button onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white shadow-md"
            style={{ background: 'linear-gradient(135deg,#D97706,#EA580C)' }}>
            <Plus size={13} /> Tambah Produk
          </button>
        </div>
      </div>

      {/* Product list */}
      {products.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-amber-200 p-10 text-center">
          <div className="text-4xl mb-3">📦</div>
          <p className="text-sm font-semibold text-gray-600">Belum ada produk</p>
          <p className="text-xs text-gray-400 mt-1">Klik "Migrasi Data" untuk import produk default, atau "Tambah Produk" untuk buat baru</p>
        </div>
      ) : (
        <div className="space-y-2">
          {products.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Thumbnail */}
                <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 relative"
                  style={{ background: `linear-gradient(135deg, ${p.bgColor}cc, ${p.bgColor}88)` }}>
                  {p.imageUrls?.[0] ? (
                    <Image src={p.imageUrls[0]} alt={p.name} fill className="object-cover" sizes="48px" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">{p.emoji}</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-bold text-gray-800 truncate">{p.name}</p>
                    {p.badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">{p.badge}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-bold text-amber-600">{formatRp(p.price)}</span>
                    <span className="text-xs text-gray-400">{p.weight}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${stockBadge(p.stock)}`}>{STOCK_LABELS[p.stock] ?? p.stock}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors">
                    {expandedId === p.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button onClick={() => openEdit(p)}
                    className="p-2 rounded-xl text-amber-500 hover:bg-amber-50 transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => del(p.id, p.name)}
                    className="p-2 rounded-xl text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
              {expandedId === p.id && (
                <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-2">
                  <p className="text-xs text-gray-500">{p.description}</p>
                  <ul className="space-y-1">
                    {p.details.map((d, i) => <li key={i} className="text-xs text-gray-400 flex gap-1.5"><span className="text-amber-400">·</span>{d}</li>)}
                  </ul>
                  {p.imageUrls?.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {p.imageUrls.map((u, i) => (
                        <div key={i} className="w-16 h-16 rounded-xl overflow-hidden relative">
                          <Image src={u} alt="" fill className="object-cover" sizes="64px" />
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-400">Stok fisik: <strong className="text-gray-700">{p.stockQty ?? 0} pcs</strong></p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit / New drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/40" onClick={closeEdit}>
          <div className="mt-auto bg-white rounded-t-3xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <p className="font-bold text-gray-800">{isNew ? 'Tambah Produk' : 'Edit Produk'}</p>
              <button onClick={closeEdit} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><X size={16} /></button>
            </div>

            <div className="px-5 py-4 space-y-4 pb-8">
              {/* Images */}
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Foto Produk</p>
                <div className="flex gap-2 flex-wrap">
                  {editing.imageUrls.map((u, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden group">
                      <Image src={u} alt="" fill className="object-cover" sizes="80px" />
                      <button onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="w-20 h-20 rounded-xl border-2 border-dashed border-amber-200 flex flex-col items-center justify-center gap-1 text-amber-400 hover:border-amber-400 hover:bg-amber-50 transition-colors disabled:opacity-50">
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                    <span className="text-[10px]">{uploading ? 'Upload...' : 'Tambah'}</span>
                  </button>
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0])} />
              </div>

              {/* Basic info */}
              {[
                { label: 'Nama Produk', key: 'name' as const, type: 'text' },
                { label: 'Emoji', key: 'emoji' as const, type: 'text' },
                { label: 'Berat / Ukuran', key: 'weight' as const, type: 'text' },
                { label: 'Harga (Rp)', key: 'price' as const, type: 'number' },
                { label: 'Harga Coret (Rp, opsional)', key: 'originalPrice' as const, type: 'number' },
                { label: 'Warna BG (hex)', key: 'bgColor' as const, type: 'text' },
                { label: 'Gradient Tailwind', key: 'gradient' as const, type: 'text' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                  <input type={f.type} value={(editing[f.key] as string | number | undefined) ?? ''}
                    onChange={e => setEditing({ ...editing, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50" />
                </div>
              ))}

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Deskripsi</label>
                <textarea rows={3} value={editing.description}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50 resize-none" />
              </div>

              {/* Details */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-500">Detail Produk</label>
                  <button onClick={addDetail} className="text-xs text-amber-600 font-bold flex items-center gap-1"><Plus size={11} /> Tambah</button>
                </div>
                <div className="space-y-2">
                  {editing.details.map((d, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={d} onChange={e => handleDetailChange(i, e.target.value)}
                        className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50" />
                      {editing.details.length > 1 && (
                        <button onClick={() => removeDetail(i)} className="p-2 text-red-400 hover:bg-red-50 rounded-xl"><X size={13} /></button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Selects */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Kategori', key: 'category' as const, opts: CAT_OPTS },
                  { label: 'Status Stok', key: 'stock' as const, opts: STOCK_OPTS },
                  { label: 'Badge', key: 'badge' as const, opts: BADGE_OPTS },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                    <select value={(editing[f.key] as string | undefined) ?? ''}
                      onChange={e => setEditing({ ...editing, [f.key]: e.target.value })}
                      className="w-full px-2 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-800 focus:outline-none focus:border-amber-400 bg-gray-50">
                      {f.opts.map(o => <option key={o} value={o}>{o || '(kosong)'}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <button onClick={save} disabled={saving || !editing.name}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white shadow-lg disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#D97706,#EA580C)' }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {saving ? 'Menyimpan...' : 'Simpan Produk'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
