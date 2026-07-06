'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Plus, Pencil, Trash2, X, Check, Loader2, ImagePlus,
  Package, ChevronDown, ChevronUp, Search,
  ChevronLeft, ChevronRight, ImageIcon, Tag,
} from 'lucide-react';
import ImageLightbox from '@/components/ImageLightbox';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import ScrollChips from '@/components/ScrollChips';
import EmojiPicker from '@/components/EmojiPicker';
import ColorThemePicker from '@/components/ColorThemePicker';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API       = '';
const PAGE_SIZE = 10;

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface FireProduct {
  id: string; name: string; description: string; details: string[];
  price: number; originalPrice?: number; emoji: string; imageUrls: string[];
  category: string; badge?: string; stock: string; gradient: string;
  bgColor: string; weight: string; stockQty?: number; order?: number;
  code?: string; openPO?: boolean;
}

interface FireCategory {
  id: string; name: string; emoji: string; description?: string; order?: number; bannerUrl?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EMPTY_PRODUCT: Omit<FireProduct, 'id'> = {
  name: '', description: '', details: [''], price: 0, emoji: '🛍️',
  imageUrls: [], category: '', badge: '', stock: 'habis',
  gradient: 'from-amber-700 to-yellow-500', bgColor: '#B45309', weight: '', stockQty: 0,
  code: '', openPO: false,
};

const EMPTY_CAT: Omit<FireCategory, 'id'> & { slug: string } = {
  name: '', emoji: '🏷️', description: '', slug: '', bannerUrl: '',
};

const STOCK_MAP = {
  ready:   { label: 'Tersedia', cls: 'badge-green' },
  habis:   { label: 'Habis',    cls: 'badge-red'   },
  open_po: { label: 'Open PO',  cls: 'badge-amber' },
};
const BADGE_OPTS = ['', 'Best Seller', 'Popular', 'New'];
const HEADER_BTN_H = 34; // samakan tinggi semua tombol di header Produk/Kategori
// Status stok dihitung dari total qty gudang (menu Stok), kecuali "Buka PO" diaktifkan manual.
const stockStatus = (p: Pick<FireProduct, 'stockQty' | 'openPO'>) =>
  p.openPO ? STOCK_MAP.open_po : (p.stockQty ?? 0) > 0 ? STOCK_MAP.ready : STOCK_MAP.habis;

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

// ─── Switch ───────────────────────────────────────────────────────────────────
function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex-shrink-0 relative transition-colors"
      style={{
        width: 38, height: 22, borderRadius: 999,
        background: checked ? 'var(--accent)' : 'var(--border)',
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ProductsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();

  // ── Product state ─────────────────────────────────────────────────
  const [products,    setProducts]    = useState<FireProduct[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [seeding,     setSeeding]     = useState(false);
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
  const [view, setView] = useViewMode('products');
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number; title?: string } | null>(null);
  const openLightbox = (images: string[], index = 0, title?: string) => {
    if (images?.length) setLightbox({ images, index, title });
  };

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
  const [catSearch,     setCatSearch]     = useState('');
  const [catPage,       setCatPage]       = useState(1);
  const [catView, setCatView] = useViewMode('categories');
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const bannerFileRef = useRef<HTMLInputElement>(null);

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
    if (!await confirm('Tambahkan 4 kategori default (Keripik, Mie, Snack, Paket)?')) return;
    setSeedingCats(true);
    const defaults = [
      { slug: 'keripik', name: 'Keripik',  emoji: '🥔', description: 'Keripik Talas Renyah',    order: 1 },
      { slug: 'mie',     name: 'Mie',      emoji: '🍝', description: 'Mie Kremes Crispy',        order: 2 },
      { slug: 'snack',   name: 'Snack',    emoji: '🍿', description: 'Cemilan Seru Lainnya',     order: 3 },
      { slug: 'paket',   name: 'Paket',    emoji: '🎁', description: 'Paket Hemat Pilihan',      order: 4 },
    ];
    let failed = 0;
    for (const d of defaults) {
      const r = await fetch(`${API}/api/categories`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      if (!r.ok) failed++;
    }
    await loadCats();
    setSeedingCats(false);
    if (failed === 0) toast.success('Kategori default berhasil ditambahkan.');
    else toast.error(`${failed} dari ${defaults.length} kategori gagal ditambahkan.`);
  };

  // ── Seed ──────────────────────────────────────────────────────────
  const seed = async () => {
    if (!await confirm('Migrasi 11 produk default ke Firestore? Produk yang sudah ada tidak akan ditimpa.')) return;
    setSeeding(true);
    const r = await fetch(`${API}/api/seed`, { method: 'POST', headers });
    if (r.ok) {
      const d = await r.json() as { seeded: number };
      toast.success(`${d.seeded} produk baru ditambahkan.`);
      await load();
    } else {
      toast.error('Gagal migrasi data produk.');
    }
    setSeeding(false);
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

  const compressImage = async (file: File): Promise<File> => {
    const MAX_PX = 1200;
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    return new Promise(resolve =>
      canvas.toBlob(
        blob => resolve(new File([blob!], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', 0.82,
      ),
    );
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers, body: form });
      if (r.ok) {
        const { url } = await r.json() as { url: string };
        if (editing) setEditing({ ...editing, imageUrls: [...editing.imageUrls, url] });
      } else {
        const { error } = await r.json() as { error?: string };
        toast.error(error ?? 'Upload gagal');
      }
    } finally {
      setUploading(false);
    }
  };

  const uploadBannerImage = async (file: File) => {
    setUploadingBanner(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('file', compressed);
      const r = await fetch(`${API}/api/upload`, { method: 'POST', headers, body: form });
      if (r.ok) {
        const { url } = await r.json() as { url: string };
        setEditingCat(ec => ec && { ...ec, bannerUrl: url });
      } else {
        const { error } = await r.json() as { error?: string };
        toast.error(error ?? 'Upload gagal');
      }
    } finally {
      setUploadingBanner(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const { id, ...rest } = editing;
    const data = {
      ...rest,
      stock: editing.openPO ? 'open_po' : (editing.stockQty ?? 0) > 0 ? 'ready' : 'habis',
    };
    const r = isNew
      ? await fetch(`${API}/api/products`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      : await fetch(`${API}/api/products/${id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Produk berhasil ditambahkan.' : 'Produk berhasil diperbarui.');
    } else {
      const { error } = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(error ?? 'Gagal menyimpan produk.');
    }
    setSaving(false);
  };

  const del = async (id: string, name: string) => {
    if (!await confirm({ message: `Hapus produk "${name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    const r = await fetch(`${API}/api/products/${id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setProducts(p => p.filter(x => x.id !== id));
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      toast.success(`"${name}" berhasil dihapus.`);
    } else {
      toast.error(`Gagal menghapus "${name}".`);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} produk yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const count = selected.size;
    const r = await fetch(`${API}/api/products/bulk-delete`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      setProducts(p => p.filter(x => !selected.has(x.id))); setSelected(new Set());
      toast.success(`${count} produk berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus produk yang dipilih.');
    }
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
          bannerUrl: editingCat.bannerUrl,
        }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        setCatError(d.error ?? 'Gagal menyimpan kategori.'); setSavingCat(false);
        toast.error(d.error ?? 'Gagal menyimpan kategori.');
        return;
      }
    } else {
      const r = await fetch(`${API}/api/categories/${editingCat.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingCat.name, emoji: editingCat.emoji, description: editingCat.description,
          bannerUrl: editingCat.bannerUrl,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        setCatError(d.error ?? 'Gagal menyimpan kategori.'); setSavingCat(false);
        toast.error(d.error ?? 'Gagal menyimpan kategori.');
        return;
      }
    }
    await loadCats(); closeEditCat(); setSavingCat(false);
    toast.success(isNewCat ? 'Kategori berhasil ditambahkan.' : 'Kategori berhasil diperbarui.');
  };

  const deleteCat = async (id: string, name: string) => {
    if (!await confirm({ message: `Hapus kategori "${name}"?`, danger: true })) return;
    setDeletingCatId(id);
    const r = await fetch(`${API}/api/categories/${id}`, { method: 'DELETE', headers });
    if (!r.ok) {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus kategori.');
    } else {
      await loadCats();
      toast.success(`Kategori "${name}" berhasil dihapus.`);
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
    .sort((a, b) => {
      const aHabis = stockStatus(a) === STOCK_MAP.habis ? 1 : 0;
      const bHabis = stockStatus(b) === STOCK_MAP.habis ? 1 : 0;
      if (aHabis !== bHabis) return aHabis - bHabis;
      return (a.order ?? 9999) - (b.order ?? 9999);
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const goPage    = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage = () => setPage(1);

  const catName  = (id: string) => categories.find(c => c.id === id)?.name  ?? id;
  const catEmoji = (id: string) => categories.find(c => c.id === id)?.emoji ?? '🏷️';

  // ── Category filter + pagination ──────────────────────────────────
  const filteredCats = categories.filter(c =>
    !catSearch || c.name.toLowerCase().includes(catSearch.toLowerCase()) || c.id.toLowerCase().includes(catSearch.toLowerCase())
  );
  const catTotalPages = Math.max(1, Math.ceil(filteredCats.length / PAGE_SIZE));
  const catSafePage   = Math.min(catPage, catTotalPages);
  const catPaginated  = filteredCats.slice((catSafePage - 1) * PAGE_SIZE, catSafePage * PAGE_SIZE);

  const goCatPage    = (p: number) => setCatPage(Math.max(1, Math.min(p, catTotalPages)));
  const resetCatPage = () => setCatPage(1);

  const renderDetail = (p: FireProduct) => (
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
            <button key={i} onClick={() => openLightbox(p.imageUrls, i, p.name)}
              className="w-16 h-16 rounded-xl overflow-hidden relative" style={{ background: 'var(--surface-2)' }}>
              <Image src={u} alt="" fill className="object-contain" sizes="64px" unoptimized />
            </button>
          ))}
        </div>
      )}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Stok fisik: <strong style={{ color: 'var(--text-secondary)' }}>{p.stockQty ?? 0} pcs</strong>
        {' · '}Kategori: <strong style={{ color: 'var(--text-secondary)' }}>{catName(p.category)}</strong>
      </p>
    </div>
  );

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Produk</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{products.length} produk · {categories.length} kategori</p>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-2">
          {/* Sub-view toggle */}
          <div className="flex rounded-xl overflow-hidden border flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
            {(['produk', 'kategori'] as const).map(v => (
              <button key={v} onClick={() => setSubView(v)}
                className="capitalize transition-all inline-flex items-center"
                style={{
                  height: HEADER_BTN_H - 2, padding: '0 16px', fontSize: 13, fontWeight: 600,
                  ...(subView === v
                    ? { background: 'var(--accent)', color: '#fff' }
                    : { color: 'var(--text-muted)' }),
                }}>
                {v === 'produk' ? '📦 Produk' : '🏷️ Kategori'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {subView === 'produk' && (
              <>
                {products.length === 0 && (
                  <button onClick={seed} disabled={seeding} className="btn-ghost text-xs" style={{ height: HEADER_BTN_H }}>
                    {seeding ? <Loader2 size={13} className="animate-spin" /> : <Package size={13} />}
                    <span className="hidden sm:inline">Migrasi Data</span>
                  </button>
                )}
                <button onClick={openNew} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Produk</span><span className="sm:hidden">Tambah</span>
                </button>
              </>
            )}

            {subView === 'kategori' && (
              <>
                {categories.length === 0 && (
                  <button onClick={seedCategories} disabled={seedingCats} className="btn-ghost text-xs" style={{ height: HEADER_BTN_H }}>
                    {seedingCats ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
                    <span className="hidden sm:inline">{seedingCats ? 'Menambahkan…' : 'Kategori Default'}</span>
                  </button>
                )}
                <button onClick={openNewCat} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Kategori</span><span className="sm:hidden">Tambah</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

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
            <>
              {/* Search + view toggle */}
              <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                  <Search size={14} style={{
                    position: 'absolute', left: 14, top: '50%',
                    transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
                  }} />
                  <input
                    value={catSearch}
                    onChange={e => { setCatSearch(e.target.value); resetCatPage(); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38 }}
                    placeholder="Cari kategori…"
                  />
                </div>
                <ViewToggle mode={catView} onChange={setCatView} />
              </div>

              {catPaginated.length === 0 ? (
                <div className="card py-12 text-center">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada kategori yang cocok.</p>
                </div>
              ) : catView === 'table' ? (
                <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                  {catPaginated.map((c, idx) => {
                    const count      = products.filter(p => p.category === c.id).length;
                    const isDeleting = deletingCatId === c.id;
                    return (
                      <div key={c.id}
                        style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                        <div className="flex items-center gap-3 px-4 py-3.5">
                          {/* Emoji / banner thumbnail */}
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 relative overflow-hidden"
                            style={{ background: 'var(--accent-bg)' }}>
                            {c.bannerUrl
                              ? <Image src={c.bannerUrl} alt="" fill className="object-cover" sizes="40px" unoptimized />
                              : c.emoji}
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
                              {!c.bannerUrl && (
                                <span className="badge badge-gray text-[10px] flex items-center gap-1">
                                  <ImageIcon size={9} /> No banner
                                </span>
                              )}
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
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {catPaginated.map(c => {
                    const count      = products.filter(p => p.category === c.id).length;
                    const isDeleting = deletingCatId === c.id;
                    return (
                      <div key={c.id} className="card overflow-hidden flex flex-col">
                        {c.bannerUrl && (
                          <div className="relative w-full" style={{ aspectRatio: '2 / 1', background: 'var(--surface-2)' }}>
                            <Image src={c.bannerUrl} alt={c.name} fill className="object-cover" sizes="(max-width: 640px) 50vw, 240px" unoptimized />
                          </div>
                        )}
                        <div className="p-4 flex flex-col gap-2 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                              style={{ background: 'var(--accent-bg)' }}>
                              {c.emoji}
                            </div>
                            <span className="badge badge-amber text-[10px] flex-shrink-0 ml-auto">{count} produk</span>
                          </div>
                          <div>
                            <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded inline-block mt-1"
                              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                              {c.id}
                            </span>
                          </div>
                          {c.description && (
                            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{c.description}</p>
                          )}
                          <div className="flex items-center justify-between mt-auto pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                            <button onClick={() => openEditCat(c)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => deleteCat(c.id, c.name)}
                              disabled={isDeleting || count > 0}
                              className="btn-ghost p-1.5 disabled:opacity-30"
                              title={count > 0 ? `Tidak bisa dihapus — ${count} produk menggunakannya` : 'Hapus kategori'}
                              style={{ color: 'var(--danger)' }}>
                              {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {catTotalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {filteredCats.length} kategori · halaman {catSafePage} dari {catTotalPages}
                  </p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => goCatPage(catSafePage - 1)} disabled={catSafePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronLeft size={14} />
                    </button>
                    {Array.from({ length: catTotalPages }, (_, i) => i + 1)
                      .filter(n => n === 1 || n === catTotalPages || Math.abs(n - catSafePage) <= 1)
                      .reduce<(number | '…')[]>((acc, n, i, arr) => {
                        if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                        acc.push(n); return acc;
                      }, [])
                      .map((n, i) =>
                        n === '…'
                          ? <span key={`ce${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                          : <button key={n} onClick={() => goCatPage(n as number)}
                              className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                              style={catSafePage === n
                                ? { background: 'var(--accent)', color: '#fff' }
                                : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                              {n}
                            </button>
                      )
                    }
                    <button onClick={() => goCatPage(catSafePage + 1)} disabled={catSafePage === catTotalPages} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Category edit modal */}
          {editingCat && (
            <div className="modal-overlay" onClick={closeEditCat}>
              <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-accent" />
                <span className="modal-handle" />

                <div className="modal-header">
                  <div className="modal-header-left">
                    <div className="modal-icon">
                      <span style={{ fontSize: 17, lineHeight: 1 }}>{editingCat.emoji || '🏷️'}</span>
                    </div>
                    <div>
                      <p className="modal-title">{isNewCat ? 'Tambah Kategori' : 'Edit Kategori'}</p>
                      <p className="modal-subtitle">{isNewCat ? 'Buat kategori produk baru' : `Edit: ${editingCat.name}`}</p>
                    </div>
                  </div>
                  <button onClick={closeEditCat} className="modal-close"><X size={14} /></button>
                </div>

                <div className="modal-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Emoji + Name */}
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flexShrink: 0 }}>
                        <label className="field-label">Emoji</label>
                        <EmojiPicker
                          value={editingCat.emoji}
                          onChange={emoji => setEditingCat({ ...editingCat, emoji })}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="field-label">Nama Kategori <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <input
                          value={editingCat.name}
                          onChange={e => {
                            const name = e.target.value;
                            setEditingCat({ ...editingCat, name, ...(isNewCat ? { slug: slugify(name) } : {}) });
                          }}
                          className="input"
                          placeholder="Contoh: Keripik"
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Slug / ID */}
                    <div>
                      <label className="field-label">
                        ID / Slug{isNewCat ? ' (auto dari nama, bisa diedit)' : ' (tidak bisa diubah)'}
                      </label>
                      <input
                        value={isNewCat ? (editingCat.slug || slugify(editingCat.name)) : editingCat.id}
                        onChange={e => isNewCat && setEditingCat({ ...editingCat, slug: slugify(e.target.value) })}
                        readOnly={!isNewCat}
                        className="input"
                        style={!isNewCat ? { opacity: 0.55, cursor: 'not-allowed', fontFamily: 'monospace' } : { fontFamily: 'monospace' }}
                        placeholder="contoh: keripik"
                      />
                      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
                        Digunakan sebagai referensi di data produk. Hanya huruf kecil, angka, dan tanda hubung.
                      </p>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="field-label">Deskripsi (opsional)</label>
                      <input
                        value={editingCat.description ?? ''}
                        onChange={e => setEditingCat({ ...editingCat, description: e.target.value })}
                        className="input"
                        placeholder="Contoh: Keripik Talas Renyah"
                      />
                    </div>

                    {/* Banner */}
                    <div>
                      <label className="field-label">Banner Kategori (opsional)</label>
                      {editingCat.bannerUrl ? (
                        <div className="relative w-full rounded-xl overflow-hidden group" style={{ aspectRatio: '2 / 1', background: 'var(--surface-2)' }}>
                          <Image src={editingCat.bannerUrl} alt="" fill className="object-cover" sizes="480px" unoptimized />
                          <button onClick={() => setEditingCat({ ...editingCat, bannerUrl: '' })}
                            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => bannerFileRef.current?.click()} disabled={uploadingBanner}
                          className="w-full rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs font-medium transition-colors"
                          style={{ aspectRatio: '2 / 1', border: '2px dashed var(--border)', color: 'var(--text-muted)', background: 'var(--surface-2)' }}>
                          {uploadingBanner ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
                          {uploadingBanner ? 'Mengunggah…' : 'Unggah Banner'}
                        </button>
                      )}
                      <input ref={bannerFileRef} type="file" accept="image/*" className="hidden"
                        onChange={e => e.target.files?.[0] && uploadBannerImage(e.target.files[0])} />
                      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
                        Tampil sebagai banner saat kategori ini dipilih di halaman toko (rasio 2:1).
                      </p>
                    </div>

                    {catError && (
                      <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                        {catError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="modal-footer">
                  <button onClick={closeEditCat} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                    Batal
                  </button>
                  <button onClick={saveCat} disabled={savingCat || !editingCat.name.trim()}
                    className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                    {savingCat ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
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
              {/* Search + view toggle */}
              <div className="flex gap-2 items-center">
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
                <ViewToggle mode={view} onChange={setView} />
              </div>

              {/* Category filter — scrolls horizontally with arrows when it overflows */}
              <ScrollChips>
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
              </ScrollChips>

              {/* Select-all bar */}
              {paginated.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 card"
                  style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
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

              {/* Product list */}
              {paginated.length === 0 ? (
                <div className="card py-12 text-center">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p>
                </div>
              ) : view === 'table' ? (
                <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                  {paginated.map((p, idx) => {
                    const stock      = stockStatus(p);
                    const outOfStock = stock.label === 'Habis';
                    const isSelected = selected.has(p.id);
                    const rowNum     = (safePage - 1) * PAGE_SIZE + idx + 1;
                    return (
                      <div key={p.id}
                        style={{
                          borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined,
                          background: isSelected ? 'rgba(212,105,30,0.05)' : undefined,
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
                          <button
                            onClick={() => p.imageUrls?.length && openLightbox(p.imageUrls, 0, p.name)}
                            disabled={!p.imageUrls?.length}
                            className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 relative"
                            style={{ background: `${p.bgColor}22`, cursor: p.imageUrls?.length ? 'pointer' : 'default' }}>
                            <div style={{ width: '100%', height: '100%', position: 'relative', filter: outOfStock ? 'grayscale(0.8) blur(2px)' : undefined, opacity: outOfStock ? 0.55 : 1, transition: 'filter 0.15s, opacity 0.15s' }}>
                              {p.imageUrls?.[0]
                                ? <Image src={p.imageUrls[0]} alt={p.name} fill className="object-contain" sizes="48px" unoptimized />
                                : <div className="w-full h-full flex items-center justify-center text-2xl">{p.emoji}</div>}
                            </div>
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                              {p.code && (
                                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                  {p.code}
                                </span>
                              )}
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
                              <span className={`badge ${stock.cls}`}>
                                {stock.label}{stock === STOCK_MAP.ready ? ` · ${p.stockQty ?? 0} pcs` : ''}
                              </span>
                              {p.category && (
                                <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                                  <span style={{ fontSize: 9, lineHeight: 1 }}>{catEmoji(p.category)}</span>
                                  {catName(p.category)}
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

                        {expandedId === p.id && renderDetail(p)}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {paginated.map(p => {
                    const stock      = stockStatus(p);
                    const outOfStock = stock.label === 'Habis';
                    const isSelected = selected.has(p.id);
                    return (
                      <div key={p.id} className="card overflow-hidden flex flex-col"
                        style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                        <div
                          onClick={() => p.imageUrls?.length && openLightbox(p.imageUrls, 0, p.name)}
                          className="relative w-full aspect-square" style={{ background: `${p.bgColor}22`, cursor: p.imageUrls?.length ? 'pointer' : 'default' }}>
                          <div style={{ width: '100%', height: '100%', position: 'relative', filter: outOfStock ? 'grayscale(0.8) blur(3px)' : undefined, opacity: outOfStock ? 0.55 : 1, transition: 'filter 0.15s, opacity 0.15s' }}>
                            {p.imageUrls?.[0]
                              ? <Image src={p.imageUrls[0]} alt={p.name} fill className="object-contain" sizes="(max-width: 640px) 50vw, 200px" unoptimized />
                              : <div className="w-full h-full flex items-center justify-center text-4xl">{p.emoji}</div>}
                          </div>
                          {outOfStock && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <span className="badge badge-red" style={{ fontSize: 11 }}>Stok Habis</span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2 rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.85)' }}>
                            <Checkbox checked={isSelected} onChange={() => toggleSelect(p.id)} />
                          </div>
                          {p.badge && <span className="absolute top-2 right-2 badge badge-amber">{p.badge}</span>}
                          {!p.imageUrls?.length && (
                            <span className="absolute bottom-2 right-2 badge badge-gray flex items-center gap-1">
                              <ImageIcon size={9} /> No img
                            </span>
                          )}
                        </div>

                        <div className="p-3 flex-1 flex flex-col gap-1.5">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>{formatRp(p.price)}</span>
                            <span className={`badge ${stock.cls}`}>
                              {stock.label}{stock === STOCK_MAP.ready ? ` · ${p.stockQty ?? 0} pcs` : ''}
                            </span>
                          </div>
                          {p.category && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full self-start"
                              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                              {catEmoji(p.category)} {catName(p.category)}
                            </span>
                          )}

                          <div className="flex items-center justify-between mt-auto pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                            <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                              className="btn-ghost px-2 py-1.5 text-xs font-semibold flex items-center gap-1">
                              Detail {expandedId === p.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                            <div className="flex items-center gap-1">
                              <button onClick={() => openEdit(p)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                                <Pencil size={12} />
                              </button>
                              <button onClick={() => del(p.id, p.name)} className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }}>
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {expandedId === p.id && renderDetail(p)}
                      </div>
                    );
                  })}
                </div>
              )}

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
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />

            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon">
                  {editing.emoji
                    ? <span style={{ fontSize: 17, lineHeight: 1 }}>{editing.emoji}</span>
                    : <Package size={17} />}
                </div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Produk' : 'Edit Produk'}</p>
                  <p className="modal-subtitle">{isNew ? 'Isi detail produk baru' : editing.name || 'Produk'}</p>
                </div>
              </div>
              <button onClick={closeEdit} className="modal-close"><X size={14} /></button>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Images */}
                <div>
                  <p className="section-label" style={{ marginBottom: 10 }}>Foto Produk</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {editing.imageUrls.map((u, i) => (
                      <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden group" style={{ background: 'var(--surface-2)' }}>
                        <Image src={u} alt="" fill className="object-contain" sizes="80px" unoptimized />
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Emoji + Name */}
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flexShrink: 0 }}>
                        <label className="field-label">Emoji</label>
                        <EmojiPicker
                          value={editing.emoji}
                          onChange={emoji => setEditing({ ...editing, emoji })}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="field-label">Nama Produk *</label>
                        <input
                          value={editing.name}
                          onChange={e => setEditing({ ...editing, name: e.target.value })}
                          className="input"
                        />
                      </div>
                    </div>

                    {([
                      { label: 'Kode Produk',    key: 'code'   as const, type: 'text' },
                      { label: 'Berat / Ukuran', key: 'weight' as const, type: 'text' },
                    ] as const).map(f => (
                      <div key={f.key}>
                        <label className="field-label">{f.label}</label>
                        <input type={f.type} value={(editing[f.key] as string) ?? ''}
                          onChange={e => setEditing({ ...editing, [f.key]: e.target.value })}
                          className="input" />
                      </div>
                    ))}

                    <div>
                      <label className="field-label">Warna & Gradient</label>
                      <ColorThemePicker
                        bgColor={editing.bgColor}
                        gradient={editing.gradient}
                        onChange={theme => setEditing({ ...editing, ...theme })}
                      />
                    </div>
                  </div>

                  {/* Col 2 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {([
                      { label: 'Harga (Rp)',                 key: 'price'         as const },
                      { label: 'Harga Coret (Rp, opsional)', key: 'originalPrice' as const },
                    ] as const).map(f => (
                      <div key={f.key}>
                        <label className="field-label">{f.label}</label>
                        <input type="number" value={(editing[f.key] as number | undefined) ?? ''}
                          onChange={e => setEditing({ ...editing, [f.key]: Number(e.target.value) })}
                          className="input" />
                      </div>
                    ))}

                    {/* Selects */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                      <div>
                        <label className="field-label">Kategori</label>
                        <select value={editing.category}
                          onChange={e => setEditing({ ...editing, category: e.target.value })}
                          className="input" style={{ fontSize: 12 }}>
                          {categories.length === 0 && <option value="">— Belum ada —</option>}
                          {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="field-label">Badge</label>
                        <select value={editing.badge ?? ''}
                          onChange={e => setEditing({ ...editing, badge: e.target.value })}
                          className="input" style={{ fontSize: 12 }}>
                          {BADGE_OPTS.map(o => <option key={o} value={o}>{o || '–'}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Status stok — read-only, dihitung dari data gudang (kecuali PO diaktifkan) */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                      <div>
                        <p className="field-label" style={{ marginBottom: 2 }}>Status Stok</p>
                        <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Otomatis dari data gudang & transaksi di menu Stok</p>
                      </div>
                      <span className={`badge ${stockStatus(editing).cls}`}>
                        {stockStatus(editing).label} · {editing.stockQty ?? 0} pcs
                      </span>
                    </div>

                    {/* Toggle Open PO */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                      <div>
                        <p className="field-label" style={{ marginBottom: 2 }}>Buka Pre-Order (PO)</p>
                        <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Aktifkan untuk tetap menerima pesanan walau stok gudang 0</p>
                      </div>
                      <Switch checked={!!editing.openPO} onChange={() => setEditing({ ...editing, openPO: !editing.openPO })} />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="field-label">Deskripsi</label>
                      <textarea rows={4} value={editing.description}
                        onChange={e => setEditing({ ...editing, description: e.target.value })}
                        className="input resize-none" />
                    </div>
                  </div>
                </div>

                {/* Detail points */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label className="field-label" style={{ marginBottom: 0 }}>Detail Produk</label>
                    <button onClick={addDetail} style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      <Plus size={11} /> Tambah baris
                    </button>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {editing.details.map((d, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8 }}>
                        <input value={d} onChange={e => handleDetailChange(i, e.target.value)} className="input flex-1" style={{ fontSize: 13 }} />
                        {editing.details.length > 1 && (
                          <button onClick={() => removeDetail(i)} className="btn-ghost" style={{ padding: '8px', color: 'var(--danger)', flexShrink: 0 }}>
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={closeEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={save} disabled={saving || !editing.name}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Produk'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Image lightbox ── */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          title={lightbox.title}
          onIndexChange={i => setLightbox(l => l && { ...l, index: i })}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
