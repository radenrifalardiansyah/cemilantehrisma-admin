'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Plus, Pencil, Trash2, X, Check, Loader2, ImagePlus,
  Package, ChevronDown, ChevronUp, Search,
  ChevronLeft, ChevronRight, ImageIcon, RefreshCw,
} from 'lucide-react';

const API       = '';
const PAGE_SIZE = 10;

interface FireProduct {
  id: string; name: string; description: string; details: string[];
  price: number; originalPrice?: number; emoji: string; imageUrls: string[];
  category: string; badge?: string; stock: string; gradient: string;
  bgColor: string; weight: string; stockQty?: number;
}

const EMPTY: Omit<FireProduct, 'id'> = {
  name: '', description: '', details: [''], price: 0, emoji: '🛍️',
  imageUrls: [], category: 'keripik', badge: '', stock: 'ready',
  gradient: 'from-amber-700 to-yellow-500', bgColor: '#B45309', weight: '', stockQty: 0,
};
const STOCK_MAP: Record<string, { label: string; cls: string }> = {
  ready:   { label: 'Tersedia', cls: 'badge-green' },
  habis:   { label: 'Habis',    cls: 'badge-red'   },
  open_po: { label: 'Open PO', cls: 'badge-amber'  },
};
const BADGE_OPTS = ['', 'Best Seller', 'Popular', 'New'];
const CAT_OPTS   = ['keripik', 'mie', 'snack', 'paket'];
const STOCK_OPTS = ['ready', 'habis', 'open_po'];
const CAT_FILTER = ['semua', ...CAT_OPTS];

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

export default function ProductsTab({ creds }: { creds: string }) {
  const [products,   setProducts]   = useState<FireProduct[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [seeding,    setSeeding]    = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState<string>('');
  const [editing,    setEditing]    = useState<FireProduct | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploading,  setUploading]  = useState(false);
  const [search,     setSearch]     = useState('');
  const [catFilter,  setCatFilter]  = useState('semua');
  const [page,       setPage]       = useState(1);
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
    if (r.ok) { const d = await r.json() as { seeded: number }; alert(`${d.seeded} produk baru ditambahkan.`); await load(); }
    setSeeding(false);
  };

  const syncImages = async () => {
    setSyncing(true); setSyncResult('');
    try {
      const r = await fetch(`${API}/api/products/sync-images`, { method: 'POST', headers });
      const text = await r.text();
      if (r.ok) {
        const d = JSON.parse(text) as { updated: number; skipped: number; errors: string[]; log?: string[]; total?: number };
        const parts = [`✓ ${d.updated} diupdate, ${d.skipped} dilewati dari ${d.total ?? '?'} produk`];
        if (d.errors.length) parts.push(`Error: ${d.errors.join(' | ')}`);
        if (d.log?.length)   parts.push(`Info: ${d.log.join(' | ')}`);
        setSyncResult(parts.join(' · '));
        if (d.updated > 0) await load();
      } else {
        setSyncResult(`✗ HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      setSyncResult(`✗ ${String(e)}`);
    }
    setSyncing(false);
  };

  const openNew   = () => { setEditing({ id: '', ...EMPTY }); setIsNew(true); };
  const openEdit  = (p: FireProduct) => { setEditing({ ...p }); setIsNew(false); };
  const closeEdit = () => { setEditing(null); setIsNew(false); };

  const handleDetailChange = (idx: number, val: string) => {
    if (!editing) return;
    const d = [...editing.details]; d[idx] = val;
    setEditing({ ...editing, details: d });
  };
  const addDetail    = () => editing && setEditing({ ...editing, details: [...editing.details, ''] });
  const removeDetail = (idx: number) => editing && setEditing({ ...editing, details: editing.details.filter((_, i) => i !== idx) });

  const uploadImage = async (file: File) => {
    setUploading(true);
    const form = new FormData();
    form.append('file', file); form.append('folder', 'products');
    const r = await fetch(`${API}/api/upload`, { method: 'POST', headers, body: form });
    if (r.ok) { const { url } = await r.json() as { url: string }; if (editing) setEditing({ ...editing, imageUrls: [...editing.imageUrls, url] }); }
    setUploading(false);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const { id, ...data } = editing;
    if (isNew) {
      await fetch(`${API}/api/products`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } else {
      await fetch(`${API}/api/products/${id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }
    await load(); closeEdit(); setSaving(false);
  };

  const del = async (id: string, name: string) => {
    if (!confirm(`Hapus "${name}"?`)) return;
    await fetch(`${API}/api/products/${id}`, { method: 'DELETE', headers });
    setProducts(p => p.filter(x => x.id !== id));
  };

  // Filter + pagination
  const filtered = products.filter(p => {
    const matchCat = catFilter === 'semua' || p.category === catFilter;
    const matchQ   = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchQ;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const goPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Produk</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{products.length} produk di Firestore</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {products.length === 0 && (
            <button onClick={seed} disabled={seeding} className="btn-ghost text-xs py-2">
              {seeding ? <Loader2 size={13} className="animate-spin" /> : <Package size={13} />}
              Migrasi Data
            </button>
          )}
          {products.length > 0 && (
            <button onClick={syncImages} disabled={syncing} className="btn-ghost text-xs py-2">
              {syncing ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
              {syncing ? 'Sync…' : 'Sync Gambar'}
            </button>
          )}
          <button onClick={openNew} className="btn-primary text-xs py-2">
            <Plus size={13} /> Tambah Produk
          </button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className="card px-4 py-2.5 flex items-center justify-between gap-3"
          style={{ background: syncResult.startsWith('✓') ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
          <p className="text-xs font-semibold" style={{ color: syncResult.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>
            {syncResult}
          </p>
          <button onClick={() => setSyncResult('')}><X size={13} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
      )}

      {/* Empty state */}
      {products.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">📦</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada produk</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Klik "Migrasi Data" untuk import produk default, atau "Tambah Produk" untuk mulai dari awal.
          </p>
        </div>
      ) : (
        <>
          {/* Search + Category filter */}
          <div className="flex gap-2 flex-col sm:flex-row">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input value={search} onChange={e => { setSearch(e.target.value); resetPage(); }}
                className="input pl-9 text-sm w-full" placeholder="Cari produk…" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {CAT_FILTER.map(c => (
                <button key={c} onClick={() => { setCatFilter(c); resetPage(); }}
                  className={`tab-chip text-xs py-1.5 capitalize ${catFilter === c ? 'active' : ''}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Product list */}
          <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
            {paginated.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p>
              </div>
            ) : paginated.map(p => {
              const stock = STOCK_MAP[p.stock] ?? { label: p.stock, cls: 'badge-gray' };
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 relative"
                      style={{ background: `${p.bgColor}22` }}>
                      {p.imageUrls?.[0]
                        ? <Image src={p.imageUrls[0]} alt={p.name} fill className="object-cover" sizes="48px" unoptimized />
                        : <div className="w-full h-full flex items-center justify-center text-2xl">{p.emoji}</div>}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                        {p.badge && <span className="badge badge-amber">{p.badge}</span>}
                        {!p.imageUrls?.length && (
                          <span className="badge badge-gray flex items-center gap-1">
                            <ImageIcon size={9} /> No img
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>{formatRp(p.price)}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.weight}</span>
                        <span className={`badge ${stock.cls}`}>{stock.label}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)} className="btn-ghost p-2">
                        {expandedId === p.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                      <button onClick={() => openEdit(p)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => del(p.id, p.name)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {expandedId === p.id && (
                    <div className="px-4 pb-4 pt-2 space-y-2" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.description}</p>
                      <ul className="space-y-1">
                        {p.details.map((d, i) => (
                          <li key={i} className="flex gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span style={{ color: 'var(--accent)' }}>·</span>{d}
                          </li>
                        ))}
                      </ul>
                      {p.imageUrls?.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {p.imageUrls.map((u, i) => (
                            <div key={i} className="w-16 h-16 rounded-xl overflow-hidden relative">
                              <Image src={u} alt="" fill className="object-cover" sizes="64px" unoptimized />
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Stok fisik: <strong style={{ color: 'var(--text-secondary)' }}>{p.stockQty ?? 0} pcs</strong>
                        {' · '}Kategori: <strong style={{ color: 'var(--text-secondary)' }}>{p.category}</strong>
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {filtered.length} produk · halaman {safePage} dari {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goPage(safePage - 1)} disabled={safePage === 1}
                  className="btn-ghost p-2 disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                  .reduce<(number | '…')[]>((acc, n, i, arr) => {
                    if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                    acc.push(n); return acc;
                  }, [])
                  .map((n, i) =>
                    n === '…'
                      ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                      : <button key={n} onClick={() => goPage(n as number)}
                          className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                          style={safePage === n
                            ? { background: 'var(--accent)', color: '#fff' }
                            : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                          {n}
                        </button>
                  )
                }
                <button
                  onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages}
                  className="btn-ghost p-2 disabled:opacity-30"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(19,12,3,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={closeEdit}>
          <div className="mt-auto lg:m-auto lg:rounded-2xl lg:w-full lg:max-w-lg max-h-[92vh] overflow-y-auto thin-scrollbar"
            style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0' }}
            onClick={e => e.stopPropagation()}>

            <div className="sticky top-0 flex items-center justify-between px-5 py-4"
              style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border-2)', borderRadius: 'inherit' }}>
              <p className="font-bold text-[15px]" style={{ color: 'var(--text-primary)' }}>
                {isNew ? 'Tambah Produk' : 'Edit Produk'}
              </p>
              <button onClick={closeEdit} className="btn-ghost p-2"><X size={16} /></button>
            </div>

            <div className="px-5 py-5 space-y-5 pb-8">
              {/* Images */}
              <div>
                <p className="section-label mb-3">Foto Produk</p>
                <div className="flex gap-2 flex-wrap">
                  {editing.imageUrls.map((u, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden group">
                      <Image src={u} alt="" fill className="object-cover" sizes="80px" unoptimized />
                      <button onClick={() => setEditing({ ...editing, imageUrls: editing.imageUrls.filter((_, j) => j !== i) })}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="w-20 h-20 rounded-xl flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors"
                    style={{ border: '2px dashed var(--border)', color: 'var(--text-muted)', background: 'var(--surface-2)' }}>
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                    {uploading ? 'Upload…' : 'Tambah'}
                  </button>
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0])} />
              </div>

              {/* Fields */}
              {([
                { label: 'Nama Produk *', key: 'name' as const, type: 'text' },
                { label: 'Emoji', key: 'emoji' as const, type: 'text' },
                { label: 'Berat / Ukuran', key: 'weight' as const, type: 'text' },
                { label: 'Harga (Rp)', key: 'price' as const, type: 'number' },
                { label: 'Harga Coret (Rp, opsional)', key: 'originalPrice' as const, type: 'number' },
                { label: 'Warna BG (hex)', key: 'bgColor' as const, type: 'text' },
                { label: 'Gradient Tailwind', key: 'gradient' as const, type: 'text' },
              ] as const).map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{f.label}</label>
                  <input type={f.type} value={(editing[f.key] as string | number | undefined) ?? ''}
                    onChange={e => setEditing({ ...editing, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                    className="input" />
                </div>
              ))}

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Deskripsi</label>
                <textarea rows={3} value={editing.description}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                  className="input resize-none" />
              </div>

              {/* Details */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Detail Produk</label>
                  <button onClick={addDetail} className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                    <Plus size={11} /> Tambah
                  </button>
                </div>
                <div className="space-y-2">
                  {editing.details.map((d, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={d} onChange={e => handleDetailChange(i, e.target.value)} className="input flex-1 text-sm" />
                      {editing.details.length > 1 && (
                        <button onClick={() => removeDetail(i)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Selects */}
              <div className="grid grid-cols-3 gap-3">
                {([
                  { label: 'Kategori', key: 'category' as const, opts: CAT_OPTS },
                  { label: 'Stok',     key: 'stock'    as const, opts: STOCK_OPTS },
                  { label: 'Badge',    key: 'badge'    as const, opts: BADGE_OPTS },
                ] as const).map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{f.label}</label>
                    <select value={(editing[f.key] as string | undefined) ?? ''}
                      onChange={e => setEditing({ ...editing, [f.key]: e.target.value })}
                      className="input text-sm">
                      {f.opts.map(o => <option key={o} value={o}>{o || '(kosong)'}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <button onClick={save} disabled={saving || !editing.name}
                className="btn-primary w-full justify-center py-3 text-sm">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {saving ? 'Menyimpan…' : 'Simpan Produk'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
