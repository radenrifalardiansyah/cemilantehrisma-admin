'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Plus, Pencil, Trash2, X, Check, Loader2, ImagePlus,
  Package, ChevronDown, ChevronUp, Search,
  ChevronLeft, ChevronRight, ImageIcon, Tag,
} from 'lucide-react';

const API       = '';
const PAGE_SIZE = 10;

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface FireProduct {
  id: string; name: string; description: string; details: string[];
  price: number; originalPrice?: number; emoji: string; imageUrls: string[];
  category: string; badge?: string; stock: string; gradient: string;
  bgColor: string; weight: string; stockQty?: number; order?: number;
}

interface FireCategory {
  id: string; name: string; emoji: string; description?: string; order?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EMPTY_PRODUCT: Omit<FireProduct, 'id'> = {
  name: '', description: '', details: [''], price: 0, emoji: '🛍️',
  imageUrls: [], category: '', badge: '', stock: 'ready',
  gradient: 'from-amber-700 to-yellow-500', bgColor: '#B45309', weight: '', stockQty: 0,
};

const EMPTY_CAT: Omit<FireCategory, 'id'> & { slug: string } = {
  name: '', emoji: '🏷️', description: '', slug: '',
};

const STOCK_MAP: Record<string, { label: string; cls: string }> = {
  ready:   { label: 'Tersedia', cls: 'badge-green' },
  habis:   { label: 'Habis',    cls: 'badge-red'   },
  open_po: { label: 'Open PO', cls: 'badge-amber'  },
};
const BADGE_OPTS = ['', 'Best Seller', 'Popular', 'New'];
const STOCK_OPTS = ['ready', 'habis', 'open_po'];

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────
function Checkbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(); }}
      className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors"
      style={{
        background:  checked || indeterminate ? 'var(--accent)' : 'transparent',
        borderColor: checked || indeterminate ? 'var(--accent)' : 'var(--border)',
      }}
    >
      {indeterminate && !checked
        ? <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />
        : checked
          ? <Check size={11} color="#fff" strokeWidth={3} />
          : null}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ProductsTab({ creds }: { creds: string }) {

  // ── Product state ─────────────────────────────────────────────────
  const [products,    setProducts]    = useState<FireProduct[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [seeding,     setSeeding]     = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState<string>('');
  const [editing,     setEditing]     = useState<FireProduct | null>(null);
  const [isNew,       setIsNew]       = useState(false);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [search,      setSearch]      = useState('');
  const [catFilter,   setCatFilter]   = useState('semua');
  const [page,        setPage]        = useState(1);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting,  setBulkDeleting]  = useState(false);
  const [seedingCats,   setSeedingCats]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Sub-view ──────────────────────────────────────────────────────
  const [subView, setSubView] = useState<'produk' | 'kategori'>('produk');

  // ── Category state ────────────────────────────────────────────────
  const [categories,    setCategories]    = useState<FireCategory[]>([]);
  const [catsLoading,   setCatsLoading]   = useState(false);
  const [editingCat,    setEditingCat]    = useState<(Omit<FireCategory, 'id'> & { id: string; slug: string }) | null>(null);
  const [isNewCat,      setIsNewCat]      = useState(false);
  const [savingCat,     setSavingCat]     = useState(false);
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [catError,      setCatError]      = useState('');

  const headers = { 'x-admin-auth': creds };

  // ── Load products ─────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/products`, { headers });
    if (r.ok) { const { products: p } = await r.json() as { products: FireProduct[] }; setProducts(p); }
    setLoading(false);
  };

  // ── Load categories ───────────────────────────────────────────────
  const loadCats = async () => {
    setCatsLoading(true);
    const r = await fetch(`${API}/api/categories`, { headers });
    if (r.ok) { const { categories: c } = await r.json() as { categories: FireCategory[] }; setCategories(c); }
    setCatsLoading(false);
  };

  useEffect(() => { load(); loadCats(); }, []);

  // ── Seed default categories ───────────────────────────────
  const seedCategories = async () => {
    if (!confirm('Tambahkan 4 kategori default (Keripik, Mie, Snack, Paket)?')) return;
    setSeedingCats(true);
    const defaults = [
      { slug: 'keripik', name: 'Keripik',  emoji: '🥔', description: 'Keripik Talas Renyah',    order: 1 },
      { slug: 'mie',     name: 'Mie',      emoji: '🍝', description: 'Mie Kremes Crispy',        order: 2 },
      { slug: 'snack',   name: 'Snack',    emoji: '🍿', description: 'Cemilan Seru Lainnya',     order: 3 },
      { slug: 'paket',   name: 'Paket',    emoji: '🎁', description: 'Paket Hemat Pilihan',      order: 4 },
    ];
    for (const d of defaults) {
      await fetch(`${API}/api/categories`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
    }
    await loadCats();
    setSeedingCats(false);
  };

  // ── Seed ──────────────────────────────────────────────────────────
  const seed = async () => {
    if (!confirm('Migrasi 11 produk default ke Firestore? Produk yang sudah ada tidak akan ditimpa.')) return;
    setSeeding(true);
    const r = await fetch(`${API}/api/seed`, { method: 'POST', headers });
    if (r.ok) { const d = await r.json() as { seeded: number }; alert(`${d.seeded} produk baru ditambahkan.`); await load(); }
    setSeeding(false);
  };

  // ── Sync images ───────────────────────────────────────────────────
  const syncImages = async () => {
    setSyncing(true); setSyncResult('');
    try {
      const r    = await fetch(`${API}/api/products/sync-images`, { method: 'POST', headers });
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

  // ── Product CRUD ──────────────────────────────────────────────────
  const openNew   = () => { setEditing({ id: '', ...EMPTY_PRODUCT, category: categories[0]?.id ?? '' }); setIsNew(true); };
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
    setSelected(s => { const n = new Set(s); n.delete(id); return n; });
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Hapus ${selected.size} produk yang dipilih? Tindakan ini tidak bisa dibatalkan.`)) return;
    setBulkDeleting(true);
    const r = await fetch(`${API}/api/products/bulk-delete`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) { setProducts(p => p.filter(x => !selected.has(x.id))); setSelected(new Set()); }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const togglePageAll = () => {
    const pageIds    = paginated.map(p => p.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  // ── Category CRUD ─────────────────────────────────────────────────
  const openNewCat  = () => { setEditingCat({ ...EMPTY_CAT, id: '' }); setIsNewCat(true);  setCatError(''); };
  const openEditCat = (c: FireCategory) => { setEditingCat({ ...c, slug: c.id }); setIsNewCat(false); setCatError(''); };
  const closeEditCat = () => { setEditingCat(null); setIsNewCat(false); setCatError(''); };

  const saveCat = async () => {
    if (!editingCat) return;
    setSavingCat(true); setCatError('');
    const slug = isNewCat ? (editingCat.slug || slugify(editingCat.name)) : editingCat.id;
    if (!slug || !editingCat.name.trim()) {
      setCatError('Nama kategori wajib diisi.'); setSavingCat(false); return;
    }
    if (isNewCat) {
      const r = await fetch(`${API}/api/categories`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug, name: editingCat.name, emoji: editingCat.emoji,
          description: editingCat.description, order: categories.length + 1,
        }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        setCatError(d.error ?? 'Gagal menyimpan kategori.'); setSavingCat(false); return;
      }
    } else {
      await fetch(`${API}/api/categories/${editingCat.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingCat.name, emoji: editingCat.emoji, description: editingCat.description }),
      });
    }
    await loadCats(); closeEditCat(); setSavingCat(false);
  };

  const deleteCat = async (id: string, name: string) => {
    if (!confirm(`Hapus kategori "${name}"?`)) return;
    setDeletingCatId(id);
    const r = await fetch(`${API}/api/categories/${id}`, { method: 'DELETE', headers });
    if (!r.ok) {
      const d = await r.json() as { error?: string };
      alert(d.error ?? 'Gagal menghapus kategori.');
    } else {
      await loadCats();
    }
    setDeletingCatId(null);
  };

  // ── Filter + pagination ───────────────────────────────────────────
  const filtered = products
    .filter(p => {
      const matchCat = catFilter === 'semua' || p.category === catFilter;
      const matchQ   = !search || p.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchQ;
    })
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const goPage    = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  const catName = (id: string) => categories.find(c => c.id === id)?.name ?? id;

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="p-4 lg:p-6 space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Produk</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{products.length} produk · {categories.length} kategori</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {/* Sub-view toggle */}
          <div className="flex rounded-xl overflow-hidden border text-xs font-bold flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
            {(['produk', 'kategori'] as const).map(v => (
              <button key={v} onClick={() => setSubView(v)}
                className="px-3.5 py-2 capitalize transition-all"
                style={subView === v
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { color: 'var(--text-muted)' }}>
                {v === 'produk' ? '📦 Produk' : '🏷️ Kategori'}
              </button>
            ))}
          </div>

          {subView === 'produk' && (
            <>
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
            </>
          )}

          {subView === 'kategori' && (
            <>
              {categories.length === 0 && (
                <button onClick={seedCategories} disabled={seedingCats} className="btn-ghost text-xs py-2">
                  {seedingCats ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
                  {seedingCats ? 'Menambahkan…' : 'Kategori Default'}
                </button>
              )}
              <button onClick={openNewCat} className="btn-primary text-xs py-2">
                <Plus size={13} /> Tambah Kategori
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Sync result banner ── */}
      {syncResult && subView === 'produk' && (
        <div className="card px-4 py-2.5 flex items-center justify-between gap-3"
          style={{ background: syncResult.startsWith('✓') ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
          <p className="text-xs font-semibold" style={{ color: syncResult.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>
            {syncResult}
          </p>
          <button onClick={() => setSyncResult('')}><X size={13} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* SUB-VIEW: KATEGORI                                          */}
      {/* ════════════════════════════════════════════════════════════ */}
      {subView === 'kategori' && (
        <>
          {catsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : categories.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="text-5xl mb-4">🏷️</div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada kategori</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Klik "Tambah Kategori" untuk membuat kategori produk pertama.
              </p>
            </div>
          ) : (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {categories.map((c, idx) => {
                const count      = products.filter(p => p.category === c.id).length;
                const isDeleting = deletingCatId === c.id;
                return (
                  <div key={c.id}
                    style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      {/* Emoji */}
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                        style={{ background: 'var(--accent-bg)' }}>
                        {c.emoji}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                            {c.id}
                          </span>
                          <span className="badge badge-amber text-[10px]">{count} produk</span>
                        </div>
                        {c.description && (
                          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{c.description}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => openEditCat(c)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => deleteCat(c.id, c.name)}
                          disabled={isDeleting || count > 0}
                          className="btn-ghost p-2 disabled:opacity-30"
                          title={count > 0 ? `Tidak bisa dihapus — ${count} produk menggunakannya` : 'Hapus kategori'}
                          style={{ color: 'var(--danger)' }}>
                          {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Category edit modal */}
          {editingCat && (
            <div
              className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-6"
              style={{ background: 'rgba(19,12,3,0.55)', backdropFilter: 'blur(6px)' }}
              onClick={closeEditCat}
            >
              <div
                className="w-full lg:max-w-md flex flex-col"
                style={{
                  background: 'var(--surface)',
                  borderRadius: '20px 20px 0 0',
                  ...(typeof window !== 'undefined' && window.innerWidth >= 1024 ? { borderRadius: 20 } : {}),
                }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <p className="font-bold text-[15px]" style={{ color: 'var(--text-primary)' }}>
                    {isNewCat ? 'Tambah Kategori' : 'Edit Kategori'}
                  </p>
                  <button onClick={closeEditCat} className="btn-ghost p-2"><X size={16} /></button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto thin-scrollbar">
                  {/* Emoji + Name */}
                  <div className="flex gap-3">
                    <div className="w-24 flex-shrink-0">
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Emoji</label>
                      <input
                        value={editingCat.emoji}
                        onChange={e => setEditingCat({ ...editingCat, emoji: e.target.value })}
                        className="input w-full text-center text-2xl"
                        maxLength={4}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Nama Kategori *</label>
                      <input
                        value={editingCat.name}
                        onChange={e => {
                          const name = e.target.value;
                          setEditingCat({
                            ...editingCat, name,
                            ...(isNewCat ? { slug: slugify(name) } : {}),
                          });
                        }}
                        className="input w-full"
                        placeholder="Contoh: Keripik"
                      />
                    </div>
                  </div>

                  {/* Slug / ID */}
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      ID / Slug{isNewCat ? ' (auto dari nama, bisa diedit)' : ' (tidak bisa diubah)'}
                    </label>
                    <input
                      value={isNewCat ? (editingCat.slug || slugify(editingCat.name)) : editingCat.id}
                      onChange={e => isNewCat && setEditingCat({ ...editingCat, slug: slugify(e.target.value) })}
                      readOnly={!isNewCat}
                      className="input w-full font-mono text-sm"
                      style={!isNewCat ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                      placeholder="contoh: keripik"
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      Digunakan sebagai referensi di data produk. Hanya huruf kecil, angka, dan tanda hubung.
                    </p>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Deskripsi (opsional)</label>
                    <input
                      value={editingCat.description ?? ''}
                      onChange={e => setEditingCat({ ...editingCat, description: e.target.value })}
                      className="input w-full"
                      placeholder="Contoh: Keripik Talas Renyah"
                    />
                  </div>

                  {catError && (
                    <p className="text-xs font-medium px-3 py-2 rounded-xl" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                      {catError}
                    </p>
                  )}
                </div>

                <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <button onClick={saveCat} disabled={savingCat || !editingCat.name.trim()}
                    className="btn-primary w-full justify-center py-3 text-sm">
                    {savingCat ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    {savingCat ? 'Menyimpan…' : 'Simpan Kategori'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* SUB-VIEW: PRODUK                                            */}
      {/* ════════════════════════════════════════════════════════════ */}
      {subView === 'produk' && (
        <>
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
                  <Search size={14} style={{
                    position: 'absolute', left: 14, top: '50%',
                    transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
                  }} />
                  <input
                    value={search}
                    onChange={e => { setSearch(e.target.value); resetPage(); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38 }}
                    placeholder="Cari produk…"
                  />
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <button onClick={() => { setCatFilter('semua'); resetPage(); }}
                    className={`tab-chip text-xs py-1.5 ${catFilter === 'semua' ? 'active' : ''}`}>
                    Semua
                  </button>
                  {categories.map(c => (
                    <button key={c.id} onClick={() => { setCatFilter(c.id); resetPage(); }}
                      className={`tab-chip text-xs py-1.5 ${catFilter === c.id ? 'active' : ''}`}>
                      {c.emoji} {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Product list */}
              <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                {paginated.length > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2.5"
                    style={{ borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                    <Checkbox
                      checked={paginated.every(p => selected.has(p.id))}
                      indeterminate={paginated.some(p => selected.has(p.id)) && !paginated.every(p => selected.has(p.id))}
                      onChange={togglePageAll}
                    />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} produk di halaman ini`}
                    </span>
                  </div>
                )}

                {paginated.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p>
                  </div>
                ) : paginated.map((p, idx) => {
                  const stock      = STOCK_MAP[p.stock] ?? { label: p.stock, cls: 'badge-gray' };
                  const isSelected = selected.has(p.id);
                  const rowNum     = (safePage - 1) * PAGE_SIZE + idx + 1;
                  return (
                    <div key={p.id}
                      style={{
                        borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined,
                        background: isSelected ? 'rgba(217,119,6,0.05)' : undefined,
                        transition: 'background 0.1s',
                      }}>
                      <div className="flex items-center gap-2 px-4 py-3.5">
                        <Checkbox checked={isSelected} onChange={() => toggleSelect(p.id)} />

                        {/* Row number */}
                        <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center"
                          style={{ color: 'var(--text-muted)' }}>
                          {rowNum}
                        </span>

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
                            {p.category && (
                              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                                <Tag size={8} /> {catName(p.category)}
                              </span>
                            )}
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
                            {' · '}Kategori: <strong style={{ color: 'var(--text-secondary)' }}>{catName(p.category)}</strong>
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
                    <button onClick={() => goPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
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
                    <button onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && subView === 'produk' && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 z-40 animate-fade-up"
          style={{ transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
          <div className="flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={bulkDelete} disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus {selected.size} Produk
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* ── Product edit modal ── */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-6"
          style={{ background: 'rgba(19,12,3,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={closeEdit}
        >
          <div
            className="w-full lg:max-w-3xl max-h-[92vh] lg:max-h-[88vh] flex flex-col"
            style={{
              background: 'var(--surface)',
              borderRadius: '20px 20px 0 0',
              ...(typeof window !== 'undefined' && window.innerWidth >= 1024 ? { borderRadius: 20 } : {}),
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid var(--border-2)' }}>
              <p className="font-bold text-[15px]" style={{ color: 'var(--text-primary)' }}>
                {isNew ? 'Tambah Produk' : 'Edit Produk'}
              </p>
              <button onClick={closeEdit} className="btn-ghost p-2"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto thin-scrollbar">
              <div className="p-6 space-y-6">

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

                {/* 2-column grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Col 1 */}
                  <div className="space-y-4">
                    {([
                      { label: 'Nama Produk *',   key: 'name'     as const, type: 'text' },
                      { label: 'Emoji',            key: 'emoji'    as const, type: 'text' },
                      { label: 'Berat / Ukuran',   key: 'weight'   as const, type: 'text' },
                      { label: 'Warna BG (hex)',   key: 'bgColor'  as const, type: 'text' },
                      { label: 'Gradient Tailwind', key: 'gradient' as const, type: 'text' },
                    ] as const).map(f => (
                      <div key={f.key}>
                        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{f.label}</label>
                        <input type={f.type} value={(editing[f.key] as string) ?? ''}
                          onChange={e => setEditing({ ...editing, [f.key]: e.target.value })}
                          className="input w-full" />
                      </div>
                    ))}
                  </div>

                  {/* Col 2 */}
                  <div className="space-y-4">
                    {([
                      { label: 'Harga (Rp)',                   key: 'price'         as const },
                      { label: 'Harga Coret (Rp, opsional)',   key: 'originalPrice' as const },
                    ] as const).map(f => (
                      <div key={f.key}>
                        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{f.label}</label>
                        <input type="number" value={(editing[f.key] as number | undefined) ?? ''}
                          onChange={e => setEditing({ ...editing, [f.key]: Number(e.target.value) })}
                          className="input w-full" />
                      </div>
                    ))}

                    {/* Selects */}
                    <div className="grid grid-cols-3 gap-2">
                      {/* Kategori — from Firestore */}
                      <div>
                        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Kategori</label>
                        <select value={editing.category}
                          onChange={e => setEditing({ ...editing, category: e.target.value })}
                          className="input text-xs">
                          {categories.length === 0 && <option value="">— Belum ada —</option>}
                          {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                        </select>
                      </div>
                      {/* Stok */}
                      <div>
                        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Stok</label>
                        <select value={editing.stock}
                          onChange={e => setEditing({ ...editing, stock: e.target.value })}
                          className="input text-xs">
                          {STOCK_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      {/* Badge */}
                      <div>
                        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Badge</label>
                        <select value={editing.badge ?? ''}
                          onChange={e => setEditing({ ...editing, badge: e.target.value })}
                          className="input text-xs">
                          {BADGE_OPTS.map(o => <option key={o} value={o}>{o || '–'}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Deskripsi</label>
                      <textarea rows={4} value={editing.description}
                        onChange={e => setEditing({ ...editing, description: e.target.value })}
                        className="input resize-none w-full" />
                    </div>
                  </div>
                </div>

                {/* Detail points */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Detail Produk</label>
                    <button onClick={addDetail} className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                      <Plus size={11} /> Tambah baris
                    </button>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {editing.details.map((d, i) => (
                      <div key={i} className="flex gap-2">
                        <input value={d} onChange={e => handleDetailChange(i, e.target.value)} className="input flex-1 text-sm" />
                        {editing.details.length > 1 && (
                          <button onClick={() => removeDetail(i)} className="btn-ghost p-2 flex-shrink-0" style={{ color: 'var(--danger)' }}>
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-shrink-0 px-6 py-4" style={{ borderTop: '1px solid var(--border-2)' }}>
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
