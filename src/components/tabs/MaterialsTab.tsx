'use client';

import { useState, useEffect } from 'react';
import {
  Boxes, ShoppingBag, Plus, Pencil, Trash2, X, Check, Loader2, RefreshCw, Package, Clock, Search,
  ChevronLeft, ChevronRight, Wrench, Ban,
} from 'lucide-react';
import TopbarPortal from '@/components/TopbarPortal';
import SearchSelect from '@/components/SearchSelect';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';
const HEADER_BTN_H = 34;

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

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

function formatDate(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateDisplay(iso?: string) {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

type SubTab = 'stok' | 'pembelian';
const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'stok',      label: 'Stok',      Icon: Boxes },
  { id: 'pembelian', label: 'Pembelian', Icon: ShoppingBag },
];

interface RawMaterial { id: string; name: string; unit: string; stockQty: number; avgCost: number }
interface Supplier { id: string; name: string }
interface PurchaseItem { materialId: string; materialName: string; unit: string; qty: number; price: number; subtotal: number }
interface Purchase {
  id: string; supplierId?: string | null; supplierName: string; items: PurchaseItem[]; total: number; note?: string;
  date?: string; paymentStatus?: 'lunas' | 'belum_lunas'; expenseId?: string | null; createdAt?: { seconds: number };
  voided?: boolean; voidNote?: string;
}

type MaterialForm = { name: string; unit: string };
const EMPTY_MATERIAL: MaterialForm = { name: '', unit: '' };

interface PurchaseRow { materialId: string; qty: string; price: string }
const EMPTY_ROW: PurchaseRow = { materialId: '', qty: '', price: '' };

export default function MaterialsTab({ creds }: { creds: string }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };

  const [subTab, setSubTab] = useState<SubTab>('stok');

  // ── Master bahan baku ──────────────────────────────────────
  const [materials,        setMaterials]        = useState<RawMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [showMForm,   setShowMForm]   = useState(false);
  const [editingM,    setEditingM]    = useState<RawMaterial | null>(null);
  const [mForm,       setMForm]       = useState<MaterialForm>(EMPTY_MATERIAL);
  const [savingM,     setSavingM]     = useState(false);
  const [deletingMId, setDeletingMId] = useState<string | null>(null);

  const [materialSearch, setMaterialSearch] = useState('');
  const [materialPage,     setMaterialPage]     = useState(1);
  const [materialPageSize, setMaterialPageSize] = useState(10);
  const [materialView, setMaterialView] = useViewMode('materials');
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [bulkDeletingMaterials, setBulkDeletingMaterials] = useState(false);

  const loadMaterials = async () => {
    setMaterialsLoading(true);
    const r = await fetch(`${API}/api/materials`, { headers });
    if (r.ok) setMaterials((await r.json() as { materials: RawMaterial[] }).materials);
    setMaterialsLoading(false);
  };

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const loadSuppliers = async () => {
    const r = await fetch(`${API}/api/suppliers`, { headers });
    if (r.ok) setSuppliers((await r.json() as { suppliers: Supplier[] }).suppliers);
  };

  const [purchases,        setPurchases]        = useState<Purchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(true);
  const loadPurchases = async () => {
    setPurchasesLoading(true);
    const r = await fetch(`${API}/api/material-purchases?limit=50`, { headers });
    if (r.ok) setPurchases((await r.json() as { purchases: Purchase[] }).purchases);
    setPurchasesLoading(false);
  };

  useEffect(() => { loadMaterials(); loadSuppliers(); loadPurchases(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateM = () => { setEditingM(null); setMForm(EMPTY_MATERIAL); setShowMForm(true); };
  const openEditM = (m: RawMaterial) => { setEditingM(m); setMForm({ name: m.name, unit: m.unit }); setShowMForm(true); };

  const saveMaterial = async () => {
    if (!mForm.name.trim() || !mForm.unit.trim()) return;
    setSavingM(true);
    const r = editingM
      ? await fetch(`${API}/api/materials/${editingM.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(mForm) })
      : await fetch(`${API}/api/materials`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(mForm) });
    if (r.ok) { await loadMaterials(); setShowMForm(false); toast.success(editingM ? 'Bahan baku berhasil diperbarui.' : 'Bahan baku berhasil ditambahkan.'); }
    else toast.error('Gagal menyimpan bahan baku.');
    setSavingM(false);
  };

  const deleteMaterial = async (m: RawMaterial) => {
    if (!await confirm({ message: `Hapus bahan baku "${m.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingMId(m.id);
    const r = await fetch(`${API}/api/materials/${m.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setMaterials(prev => prev.filter(x => x.id !== m.id));
      setSelectedMaterials(s => { const n = new Set(s); n.delete(m.id); return n; });
      toast.success(`"${m.name}" berhasil dihapus.`);
    }
    else toast.error('Gagal menghapus bahan baku.');
    setDeletingMId(null);
  };

  // ── Koreksi stok/harga langsung (tanpa menulis ulang riwayat pembelian/produksi) ──
  const [adjustingMaterial, setAdjustingMaterial] = useState<RawMaterial | null>(null);
  const [adjustStockQty, setAdjustStockQty] = useState('');
  const [adjustAvgCost,  setAdjustAvgCost]  = useState('');
  const [adjustNote,     setAdjustNote]     = useState('');
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  const openAdjust = (m: RawMaterial) => {
    setAdjustingMaterial(m);
    setAdjustStockQty(String(m.stockQty));
    setAdjustAvgCost(String(m.avgCost));
    setAdjustNote('');
  };
  const closeAdjust = () => { setAdjustingMaterial(null); setAdjustStockQty(''); setAdjustAvgCost(''); setAdjustNote(''); };

  const submitAdjust = async () => {
    if (!adjustingMaterial || !adjustNote.trim()) return;
    setSubmittingAdjust(true);
    try {
      const res = await fetch(`${API}/api/materials/${adjustingMaterial.id}/adjust`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newStockQty: parseFloat(adjustStockQty) || 0,
          newAvgCost: parseFloat(adjustAvgCost) || 0,
          note: adjustNote.trim(),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal menyimpan koreksi.'); return; }
      toast.success(`Stok & harga "${adjustingMaterial.name}" berhasil dikoreksi.`);
      closeAdjust();
      await loadMaterials();
    } finally { setSubmittingAdjust(false); }
  };

  const toggleSelectMaterial = (id: string) =>
    setSelectedMaterials(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkDeleteMaterials = async () => {
    if (selectedMaterials.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedMaterials.size} bahan baku yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeletingMaterials(true);
    const count = selectedMaterials.size;
    const r = await fetch(`${API}/api/materials/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedMaterials] }),
    });
    if (r.ok) {
      setMaterials(prev => prev.filter(x => !selectedMaterials.has(x.id)));
      setSelectedMaterials(new Set());
      toast.success(`${count} bahan baku berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus bahan baku yang dipilih.');
    }
    setBulkDeletingMaterials(false);
  };

  const filteredMaterials = materials
    .filter(m => !materialSearch || m.name.toLowerCase().includes(materialSearch.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const materialTotalPages = Math.max(1, Math.ceil(filteredMaterials.length / materialPageSize));
  const materialSafePage   = Math.min(materialPage, materialTotalPages);
  const paginatedMaterials = filteredMaterials.slice((materialSafePage - 1) * materialPageSize, materialSafePage * materialPageSize);
  const goMaterialPage    = (p: number) => setMaterialPage(Math.max(1, Math.min(p, materialTotalPages)));
  const resetMaterialPage = () => setMaterialPage(1);

  const toggleMaterialPageAll = () => {
    const pageIds     = paginatedMaterials.map(m => m.id);
    const allSelected = pageIds.every(id => selectedMaterials.has(id));
    setSelectedMaterials(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  // ── Form pembelian ──────────────────────────────────────────
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [editingPurchase, setEditingPurchase]   = useState<Purchase | null>(null);
  const [supplierId,   setSupplierId]   = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [purchaseDate,  setPurchaseDate] = useState(todayISO());
  const [rows,         setRows]         = useState<PurchaseRow[]>([{ ...EMPTY_ROW }]);
  const [purchaseNote, setPurchaseNote] = useState('');
  const [purchasePaymentStatus, setPurchasePaymentStatus] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [submittingPurchase, setSubmittingPurchase] = useState(false);
  const [markingPurchaseId, setMarkingPurchaseId] = useState<string | null>(null);

  const resetPurchaseForm = () => {
    setEditingPurchase(null); setSupplierId(''); setSupplierName(''); setPurchaseDate(todayISO());
    setRows([{ ...EMPTY_ROW }]); setPurchaseNote(''); setPurchasePaymentStatus('lunas');
  };
  const openCreatePurchase = () => { resetPurchaseForm(); setShowPurchaseForm(true); };
  const openEditPurchase = (p: Purchase) => {
    setEditingPurchase(p);
    setSupplierId(p.supplierId ?? '');
    setSupplierName(p.supplierName ?? '');
    setPurchaseDate(p.date || todayISO());
    setRows(p.items.map(it => ({ materialId: it.materialId, qty: String(it.qty), price: String(it.price) })));
    setPurchaseNote(p.note ?? '');
    setPurchasePaymentStatus(p.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas');
    setShowPurchaseForm(true);
  };
  const closePurchaseForm = () => { setShowPurchaseForm(false); resetPurchaseForm(); };

  const addRow    = () => setRows(prev => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<PurchaseRow>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const purchaseTotal = rows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0), 0);
  const canSubmitPurchase = supplierName.trim() !== '' && !!purchaseDate
    && rows.some(r => r.materialId && (parseFloat(r.qty) || 0) > 0);

  const submitPurchase = async () => {
    if (!canSubmitPurchase) return;
    setSubmittingPurchase(true);
    try {
      const items = rows
        .filter(r => r.materialId && (parseFloat(r.qty) || 0) > 0)
        .map(r => {
          const m = materials.find(mm => mm.id === r.materialId)!;
          return { materialId: m.id, materialName: m.name, unit: m.unit, qty: parseFloat(r.qty) || 0, price: parseFloat(r.price) || 0 };
        });
      const payload = {
        supplierId: supplierId || undefined, supplierName: supplierName.trim(), date: purchaseDate, items, note: purchaseNote,
        paymentStatus: purchasePaymentStatus,
      };
      const res = editingPurchase
        ? await fetch(`${API}/api/material-purchases/${editingPurchase.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(`${API}/api/material-purchases`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal menyimpan pembelian.'); return; }
      toast.success(editingPurchase ? 'Perubahan pembelian tersimpan.' : 'Pembelian bahan baku tersimpan.');
      closePurchaseForm();
      await Promise.all([loadMaterials(), loadPurchases()]);
    } finally { setSubmittingPurchase(false); }
  };

  const markPurchaseLunas = async (id: string) => {
    setMarkingPurchaseId(id);
    const r = await fetch(`${API}/api/material-purchases/${id}/mark-lunas`, { method: 'POST', headers });
    if (r.ok) { toast.success('Pembelian ditandai lunas — sudah tercatat di Pengeluaran.'); await loadPurchases(); }
    else toast.error('Gagal menandai lunas.');
    setMarkingPurchaseId(null);
  };

  const [deletingPurchaseId, setDeletingPurchaseId] = useState<string | null>(null);
  const deletePurchase = async (p: Purchase) => {
    if (!await confirm({ message: `Hapus pembelian dari "${p.supplierName || 'Tanpa nama'}"? Stok & harga rata-rata bahan baku akan dikembalikan seperti sebelum pembelian ini.`, danger: true })) return;
    setDeletingPurchaseId(p.id);
    const r = await fetch(`${API}/api/material-purchases/${p.id}`, { method: 'DELETE', headers });
    const data = await r.json().catch(() => ({})) as { error?: string };
    if (r.ok) { toast.success('Pembelian berhasil dihapus, stok bahan baku dikembalikan.'); await Promise.all([loadMaterials(), loadPurchases()]); }
    else toast.error(`${data.error ?? 'Gagal menghapus pembelian.'} Coba tombol "Batalkan" sebagai gantinya.`);
    setDeletingPurchaseId(null);
  };

  const [voidingPurchaseId, setVoidingPurchaseId] = useState<string | null>(null);
  const voidPurchase = async (p: Purchase) => {
    if (!await confirm({
      message: `Batalkan pembelian dari "${p.supplierName || 'Tanpa nama'}"? Pengeluaran otomatisnya (kalau ada) akan dihapus, TAPI stok bahan baku yang sudah bertambah TIDAK dikurangi lagi (karena sudah dipakai/berubah). Kalau stok sekarang perlu dibetulkan, pakai "Koreksi" di menu Stok setelah ini.`,
      danger: true,
    })) return;
    setVoidingPurchaseId(p.id);
    const r = await fetch(`${API}/api/material-purchases/${p.id}/void`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const data = await r.json().catch(() => ({})) as { error?: string };
    if (r.ok) { toast.success('Pembelian dibatalkan — tidak lagi dihitung sebagai pengeluaran.'); await loadPurchases(); }
    else toast.error(data.error ?? 'Gagal membatalkan pembelian.');
    setVoidingPurchaseId(null);
  };

  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchasePage,     setPurchasePage]     = useState(1);
  const [purchasePageSize, setPurchasePageSize] = useState(10);
  const [purchaseView, setPurchaseView] = useViewMode('material-purchases');
  const [selectedPurchases, setSelectedPurchases] = useState<Set<string>>(new Set());
  const [bulkDeletingPurchases, setBulkDeletingPurchases] = useState(false);

  const toggleSelectPurchase = (id: string) =>
    setSelectedPurchases(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Tiap pembelian punya pengecekan keamanan sendiri (lihat DELETE /api/material-purchases/[id]),
  // jadi hapus massal memanggil endpoint yang sama satu per satu & melaporkan yang gagal/diblokir.
  const bulkDeletePurchases = async () => {
    if (selectedPurchases.size === 0) return;
    if (!await confirm({ message: `Hapus ${selectedPurchases.size} pembelian yang dipilih? Yang sudah dipakai/dibeli lagi setelahnya akan otomatis dilewati.`, danger: true })) return;
    setBulkDeletingPurchases(true);
    const ids = [...selectedPurchases];
    let okCount = 0, blockedCount = 0;
    for (const id of ids) {
      const r = await fetch(`${API}/api/material-purchases/${id}`, { method: 'DELETE', headers });
      if (r.ok) okCount++; else blockedCount++;
    }
    setSelectedPurchases(new Set());
    await Promise.all([loadMaterials(), loadPurchases()]);
    if (okCount > 0) toast.success(`${okCount} pembelian berhasil dihapus.${blockedCount > 0 ? ` ${blockedCount} dilewati karena sudah dipakai/dibeli lagi.` : ''}`);
    else toast.error('Semua pembelian yang dipilih tidak bisa dihapus (sudah dipakai/dibeli lagi setelahnya).');
    setBulkDeletingPurchases(false);
  };

  const filteredPurchases = purchases
    .filter(p => !purchaseSearch || (p.supplierName ?? '').toLowerCase().includes(purchaseSearch.toLowerCase()));
  const purchaseTotalPages = Math.max(1, Math.ceil(filteredPurchases.length / purchasePageSize));
  const purchaseSafePage   = Math.min(purchasePage, purchaseTotalPages);
  const paginatedPurchases = filteredPurchases.slice((purchaseSafePage - 1) * purchasePageSize, purchaseSafePage * purchasePageSize);
  const goPurchasePage    = (p: number) => setPurchasePage(Math.max(1, Math.min(p, purchaseTotalPages)));
  const resetPurchasePage = () => setPurchasePage(1);

  const togglePurchasePageAll = () => {
    const pageIds     = paginatedPurchases.map(p => p.id);
    const allSelected = pageIds.every(id => selectedPurchases.has(id));
    setSelectedPurchases(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const materialOptions = materials.map(m => ({ value: m.id, label: m.name, sublabel: m.unit }));
  const supplierOptions = [
    { value: '', label: '– Supplier lain / tidak tercatat –' },
    ...suppliers.map(s => ({ value: s.id, label: s.name })),
  ];
  const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <button onClick={() => { loadMaterials(); loadPurchases(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
          <RefreshCw size={14} className={materialsLoading || purchasesLoading ? 'animate-spin' : ''} />
        </button>
      </TopbarPortal>

      {/* Sub-tab switcher */}
      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="inline-flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all"
              style={subTab === t.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
              <t.Icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {/* ════ STOK ═══════════════════════════════════════════ */}
        {subTab === 'stok' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            {/* Header: search + actions in one row */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {materials.length > 0 && (
                <div className="relative flex-1 min-w-0">
                  <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    value={materialSearch}
                    onChange={e => { setMaterialSearch(e.target.value); resetMaterialPage(); }}
                    className="input text-sm w-full"
                    style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                    placeholder="Cari nama bahan baku…"
                  />
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap sm:justify-end flex-shrink-0">
                {materials.length > 0 && <ViewToggle mode={materialView} onChange={setMaterialView} height={HEADER_BTN_H} />}
                <button onClick={openCreateM} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Tambah Bahan Baku</span><span className="sm:hidden">Tambah</span>
                </button>
              </div>
            </div>

            {materialsLoading && materials.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : materials.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <Boxes size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada bahan baku</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tambahkan bahan baku untuk mulai catat pembelian & produksi</p>
              </div>
            ) : (
              <>
                {paginatedMaterials.length > 0 && (
                  <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                    <Checkbox
                      checked={paginatedMaterials.every(m => selectedMaterials.has(m.id))}
                      indeterminate={paginatedMaterials.some(m => selectedMaterials.has(m.id)) && !paginatedMaterials.every(m => selectedMaterials.has(m.id))}
                      onChange={toggleMaterialPageAll}
                    />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {selectedMaterials.size > 0 ? `${selectedMaterials.size} dipilih` : `${paginatedMaterials.length} bahan baku di halaman ini`}
                    </span>
                  </div>
                )}

                {paginatedMaterials.length === 0 ? (
                  <div className="card py-12 text-center">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada bahan baku yang cocok.</p>
                  </div>
                ) : materialView === 'table' ? (
                  <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
                    {paginatedMaterials.map(m => {
                      const isSelected = selectedMaterials.has(m.id);
                      return (
                        <div key={m.id} className="px-4 py-3 flex items-center gap-3" style={{ background: isSelected ? 'rgba(212,105,30,0.05)' : undefined }}>
                          <Checkbox checked={isSelected} onChange={() => toggleSelectMaterial(m.id)} />
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                            <Package size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                            <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                              Stok {m.stockQty} {m.unit} · Rata-rata {formatRp(m.avgCost)}/{m.unit}
                            </p>
                          </div>
                          <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--accent-dark)' }}>
                            {formatRp(m.stockQty * m.avgCost)}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => openAdjust(m)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Koreksi Stok/Harga">
                              <Wrench size={12} />
                            </button>
                            <button onClick={() => openEditM(m)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => deleteMaterial(m)} disabled={deletingMId === m.id} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                              {deletingMId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {paginatedMaterials.map(m => {
                      const isSelected = selectedMaterials.has(m.id);
                      return (
                        <div key={m.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                          <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                            <Checkbox checked={isSelected} onChange={() => toggleSelectMaterial(m.id)} />
                          </div>
                          <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                            <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                              <Package size={20} />
                            </div>
                            <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                            <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>Stok {m.stockQty} {m.unit}</p>
                            <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>Rata-rata {formatRp(m.avgCost)}/{m.unit}</p>
                            <p className="text-base font-extrabold tabular mt-1" style={{ color: 'var(--accent-dark)' }}>{formatRp(m.stockQty * m.avgCost)}</p>
                          </div>
                          <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                            <button onClick={() => openAdjust(m)} className="btn-ghost p-1.5" style={{ color: 'var(--text-secondary)' }} title="Koreksi Stok/Harga">
                              <Wrench size={12} />
                            </button>
                            <button onClick={() => openEditM(m)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => deleteMaterial(m)} disabled={deletingMId === m.id} className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }}>
                              {deletingMId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {filteredMaterials.length > 0 && (
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {filteredMaterials.length} bahan baku · halaman {materialSafePage} dari {materialTotalPages}
                      </p>
                      <PageSizeSelect value={materialPageSize} onChange={n => { setMaterialPageSize(n); resetMaterialPage(); }} />
                    </div>
                    {materialTotalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => goMaterialPage(materialSafePage - 1)} disabled={materialSafePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                          <ChevronLeft size={14} />
                        </button>
                        {Array.from({ length: materialTotalPages }, (_, i) => i + 1)
                          .filter(n => n === 1 || n === materialTotalPages || Math.abs(n - materialSafePage) <= 1)
                          .reduce<(number | '…')[]>((acc, n, i, arr) => {
                            if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                            acc.push(n); return acc;
                          }, [])
                          .map((n, i) =>
                            n === '…'
                              ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                              : <button key={n} onClick={() => goMaterialPage(n as number)}
                                  className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                                  style={materialSafePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                                  {n}
                                </button>
                          )
                        }
                        <button onClick={() => goMaterialPage(materialSafePage + 1)} disabled={materialSafePage === materialTotalPages} className="btn-ghost p-2 disabled:opacity-30">
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Bulk action bar */}
            {selectedMaterials.size > 0 && (
              <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
                <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
                  style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
                  <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedMaterials.size} dipilih</span>
                  <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
                  <button onClick={bulkDeleteMaterials} disabled={bulkDeletingMaterials}
                    className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                    style={{ background: 'var(--danger)', color: '#fff' }}>
                    {bulkDeletingMaterials ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    Hapus
                  </button>
                  <button onClick={() => setSelectedMaterials(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ PEMBELIAN ══════════════════════════════════════ */}
        {subTab === 'pembelian' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={11} /> Riwayat Pembelian ({purchases.length})
                </p>
                {purchases.length > 0 && (
                  <div className="relative flex-1 min-w-0">
                    <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                    <input
                      value={purchaseSearch}
                      onChange={e => { setPurchaseSearch(e.target.value); resetPurchasePage(); }}
                      className="input text-sm w-full"
                      style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                      placeholder="Cari nama supplier…"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap sm:justify-end flex-shrink-0">
                  {purchases.length > 0 && <ViewToggle mode={purchaseView} onChange={setPurchaseView} height={HEADER_BTN_H} />}
                  <button onClick={openCreatePurchase} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
                    <Plus size={13} /> <span className="hidden sm:inline">Catat Pembelian</span><span className="sm:hidden">Tambah</span>
                  </button>
                </div>
              </div>

              {purchasesLoading && purchases.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
                </div>
              ) : purchases.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat pembelian.</p>
              ) : (
                <>
                  {paginatedPurchases.length > 0 && (
                    <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                      <Checkbox
                        checked={paginatedPurchases.every(p => selectedPurchases.has(p.id))}
                        indeterminate={paginatedPurchases.some(p => selectedPurchases.has(p.id)) && !paginatedPurchases.every(p => selectedPurchases.has(p.id))}
                        onChange={togglePurchasePageAll}
                      />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {selectedPurchases.size > 0 ? `${selectedPurchases.size} dipilih` : `${paginatedPurchases.length} pembelian di halaman ini`}
                      </span>
                    </div>
                  )}

                  {paginatedPurchases.length === 0 ? (
                    <div className="card py-10 text-center">
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada pembelian yang cocok.</p>
                    </div>
                  ) : purchaseView === 'table' ? (
                    <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
                      {paginatedPurchases.map(p => {
                        const isSelected = selectedPurchases.has(p.id);
                        return (
                          <div key={p.id} className="px-4 py-3" style={{ background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, opacity: p.voided ? 0.55 : 1 }}>
                            <div className="flex items-start gap-3">
                              <div className="pt-0.5"><Checkbox checked={isSelected} onChange={() => toggleSelectPurchase(p.id)} /></div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)', textDecoration: p.voided ? 'line-through' : undefined }}>{p.supplierName || 'Tanpa nama'}</p>
                                    {p.voided && <span className="badge badge-gray">Dibatalkan</span>}
                                    {!p.voided && p.paymentStatus === 'belum_lunas' && <span className="badge badge-amber">Belum Lunas</span>}
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(p.total)}</span>
                                    {!p.voided && (
                                      <>
                                        {p.paymentStatus === 'belum_lunas' && (
                                          <button onClick={() => markPurchaseLunas(p.id)} disabled={markingPurchaseId === p.id}
                                            className="btn-ghost px-2.5 py-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                                            {markingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : 'Tandai Lunas'}
                                          </button>
                                        )}
                                        <button onClick={() => openEditPurchase(p)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }} title="Edit">
                                          <Pencil size={12} />
                                        </button>
                                        <button onClick={() => deletePurchase(p)} disabled={deletingPurchaseId === p.id}
                                          className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }} title="Hapus">
                                          {deletingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                        </button>
                                        <button onClick={() => voidPurchase(p)} disabled={voidingPurchaseId === p.id}
                                          className="btn-ghost p-1.5" style={{ color: 'var(--text-muted)' }} title="Batalkan (kalau tidak bisa dihapus)">
                                          {voidingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{p.date ? formatDateDisplay(p.date) : formatDate(p.createdAt?.seconds)}</p>
                                <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                                  {p.items.map(it => `${it.materialName} (${it.qty} ${it.unit})`).join(', ')}
                                </p>
                                {p.voided && p.voidNote && (
                                  <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>Alasan batal: {p.voidNote}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {paginatedPurchases.map(p => {
                        const isSelected = selectedPurchases.has(p.id);
                        return (
                          <div key={p.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2, opacity: p.voided ? 0.55 : 1 }}>
                            <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                              <Checkbox checked={isSelected} onChange={() => toggleSelectPurchase(p.id)} />
                            </div>
                            <div className="pt-8 pb-3 px-4">
                              <div className="flex items-center gap-1.5 flex-wrap justify-center text-center">
                                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)', textDecoration: p.voided ? 'line-through' : undefined }}>{p.supplierName || 'Tanpa nama'}</p>
                              </div>
                              {p.voided && <div className="text-center mt-1"><span className="badge badge-gray">Dibatalkan</span></div>}
                              {!p.voided && p.paymentStatus === 'belum_lunas' && <div className="text-center mt-1"><span className="badge badge-amber">Belum Lunas</span></div>}
                              <p className="text-xs text-center mt-1" style={{ color: 'var(--text-muted)' }}>{p.date ? formatDateDisplay(p.date) : formatDate(p.createdAt?.seconds)}</p>
                              <p className="text-xs text-center mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                                {p.items.map(it => `${it.materialName} (${it.qty} ${it.unit})`).join(', ')}
                              </p>
                              <p className="text-base font-extrabold tabular text-center mt-2" style={{ color: 'var(--success)' }}>{formatRp(p.total)}</p>
                            </div>
                            {!p.voided && (
                              <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                                {p.paymentStatus === 'belum_lunas' && (
                                  <button onClick={() => markPurchaseLunas(p.id)} disabled={markingPurchaseId === p.id}
                                    className="btn-ghost px-2.5 py-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                                    {markingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : 'Tandai Lunas'}
                                  </button>
                                )}
                                <button onClick={() => openEditPurchase(p)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }} title="Edit">
                                  <Pencil size={12} />
                                </button>
                                <button onClick={() => deletePurchase(p)} disabled={deletingPurchaseId === p.id}
                                  className="btn-ghost p-1.5" style={{ color: 'var(--danger)' }} title="Hapus">
                                  {deletingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                </button>
                                <button onClick={() => voidPurchase(p)} disabled={voidingPurchaseId === p.id}
                                  className="btn-ghost p-1.5" style={{ color: 'var(--text-muted)' }} title="Batalkan (kalau tidak bisa dihapus)">
                                  {voidingPurchaseId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                                </button>
                              </div>
                            )}
                            {p.voided && p.voidNote && (
                              <p className="text-xs text-center px-4 pb-3 italic" style={{ color: 'var(--text-muted)' }}>Alasan batal: {p.voidNote}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {filteredPurchases.length > 0 && (
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {filteredPurchases.length} pembelian · halaman {purchaseSafePage} dari {purchaseTotalPages}
                        </p>
                        <PageSizeSelect value={purchasePageSize} onChange={n => { setPurchasePageSize(n); resetPurchasePage(); }} />
                      </div>
                      {purchaseTotalPages > 1 && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => goPurchasePage(purchaseSafePage - 1)} disabled={purchaseSafePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                            <ChevronLeft size={14} />
                          </button>
                          {Array.from({ length: purchaseTotalPages }, (_, i) => i + 1)
                            .filter(n => n === 1 || n === purchaseTotalPages || Math.abs(n - purchaseSafePage) <= 1)
                            .reduce<(number | '…')[]>((acc, n, i, arr) => {
                              if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                              acc.push(n); return acc;
                            }, [])
                            .map((n, i) =>
                              n === '…'
                                ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                                : <button key={n} onClick={() => goPurchasePage(n as number)}
                                    className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                                    style={purchaseSafePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                                    {n}
                                  </button>
                            )
                          }
                          <button onClick={() => goPurchasePage(purchaseSafePage + 1)} disabled={purchaseSafePage === purchaseTotalPages} className="btn-ghost p-2 disabled:opacity-30">
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Bulk action bar */}
              {selectedPurchases.size > 0 && (
                <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
                  <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
                    style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
                    <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selectedPurchases.size} dipilih</span>
                    <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
                    <button onClick={bulkDeletePurchases} disabled={bulkDeletingPurchases}
                      className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
                      style={{ background: 'var(--danger)', color: '#fff' }}>
                      {bulkDeletingPurchases ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Hapus
                    </button>
                    <button onClick={() => setSelectedPurchases(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showMForm && (
        <div className="modal-overlay" onClick={() => !savingM && setShowMForm(false)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Boxes size={17} /></div>
                <div>
                  <p className="modal-title">{editingM ? 'Edit Bahan Baku' : 'Tambah Bahan Baku Baru'}</p>
                  <p className="modal-subtitle">{editingM ? 'Perbarui nama & satuan' : 'Stok & harga rata-rata mulai dari pembelian pertama'}</p>
                </div>
              </div>
              <button onClick={() => setShowMForm(false)} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="field-label">Nama Bahan Baku <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="text" value={mForm.name} onChange={e => setMForm({ ...mForm, name: e.target.value })}
                    placeholder="cth: Tepung Terigu" autoFocus className="input" />
                </div>
                <div>
                  <label className="field-label">Satuan <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="text" value={mForm.unit} onChange={e => setMForm({ ...mForm, unit: e.target.value })}
                    placeholder="cth: kg, liter, pcs" className="input" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowMForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={saveMaterial} disabled={savingM || !mForm.name.trim() || !mForm.unit.trim()}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingM ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {savingM ? 'Menyimpan…' : editingM ? 'Simpan Perubahan' : 'Tambah Bahan Baku'}
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustingMaterial && (
        <div className="modal-overlay" onClick={() => !submittingAdjust && closeAdjust()}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Wrench size={17} /></div>
                <div>
                  <p className="modal-title">Koreksi Stok/Harga</p>
                  <p className="modal-subtitle">{adjustingMaterial.name}</p>
                </div>
              </div>
              <button onClick={closeAdjust} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Membetulkan angka <strong>saat ini</strong> langsung — tidak mengubah riwayat pembelian/produksi yang sudah tercatat.
                  Stok sekarang: <strong className="tabular">{adjustingMaterial.stockQty} {adjustingMaterial.unit}</strong>,
                  harga rata-rata: <strong className="tabular">{formatRp(adjustingMaterial.avgCost)}</strong>.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Stok Benar ({adjustingMaterial.unit})</label>
                    <input type="number" min="0" value={adjustStockQty} onChange={e => setAdjustStockQty(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label className="field-label">Harga Rata-rata Benar (Rp)</label>
                    <input type="number" min="0" value={adjustAvgCost} onChange={e => setAdjustAvgCost(e.target.value)} className="input" />
                  </div>
                </div>
                <div>
                  <label className="field-label">Alasan Koreksi <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <textarea value={adjustNote} onChange={e => setAdjustNote(e.target.value)}
                    className="input resize-none" rows={3} placeholder="cth: Stok opname fisik, koreksi salah input harga pembelian tgl 3 Agustus, dll" autoFocus />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeAdjust} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={submitAdjust} disabled={submittingAdjust || !adjustNote.trim()}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {submittingAdjust ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                {submittingAdjust ? 'Menyimpan…' : 'Simpan Koreksi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPurchaseForm && (
        <div className="modal-overlay" onClick={() => !submittingPurchase && closePurchaseForm()}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingBag size={17} /></div>
                <div>
                  <p className="modal-title">{editingPurchase ? 'Edit Pembelian' : 'Catat Pembelian Bahan Baku'}</p>
                  <p className="modal-subtitle">Stok & harga rata-rata bahan baku ter-update otomatis</p>
                </div>
              </div>
              <button onClick={closePurchaseForm} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Supplier</label>
                    <SearchSelect value={supplierId}
                      onChange={id => { setSupplierId(id); const s = suppliers.find(ss => ss.id === id); if (s) setSupplierName(s.name); }}
                      options={supplierOptions} placeholder="– Pilih Supplier –" searchPlaceholder="Cari supplier…" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Nama Supplier <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)}
                      placeholder="Isi manual kalau supplier tidak terdaftar" className="input" />
                  </div>
                </div>

                <div>
                  <label style={fieldLabel}>Tanggal Pembelian <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="input" style={{ maxWidth: 220 }} />
                </div>

                <div>
                  <label style={fieldLabel}>Bahan Baku Dibeli</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rows.map((row, i) => {
                      const qty = parseFloat(row.qty) || 0;
                      const price = parseFloat(row.price) || 0;
                      const material = materials.find(m => m.id === row.materialId);
                      return (
                        <div key={i} className="grid gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', alignItems: 'center' }}>
                          <SearchSelect value={row.materialId} onChange={id => updateRow(i, { materialId: id })}
                            options={materialOptions} placeholder="– Bahan baku –" searchPlaceholder="Cari bahan baku…" />
                          <input type="number" min="0" value={row.qty} onChange={e => updateRow(i, { qty: e.target.value })}
                            placeholder={`Qty${material ? ` (${material.unit})` : ''}`} className="input" />
                          <input type="number" min="0" value={row.price} onChange={e => updateRow(i, { price: e.target.value })}
                            placeholder="Harga/satuan" className="input" />
                          <button onClick={() => removeRow(i)} disabled={rows.length === 1}
                            className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }} title="Hapus baris">
                            <X size={14} />
                          </button>
                          {qty > 0 && price > 0 && (
                            <p className="text-xs tabular" style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', marginTop: -4 }}>
                              Subtotal: {formatRp(qty * price)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={addRow} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Bahan Baku
                  </button>
                </div>

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={purchaseNote} onChange={e => setPurchaseNote(e.target.value)}
                    placeholder="Catatan tambahan (opsional)" className="input" />
                </div>

                <div>
                  <label style={fieldLabel}>Status Pembayaran</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['lunas', 'belum_lunas'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setPurchasePaymentStatus(s)}
                        className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                        style={purchasePaymentStatus === s ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {s === 'lunas' ? 'Lunas' : 'Belum Lunas'}
                      </button>
                    ))}
                  </div>
                  {purchasePaymentStatus === 'belum_lunas' && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Stok tetap bertambah sekarang, tapi belum tercatat sebagai Pengeluaran sampai ditandai Lunas.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Pembelian</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(purchaseTotal)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closePurchaseForm} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={submitPurchase} disabled={submittingPurchase || !canSubmitPurchase}
                className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {submittingPurchase ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {submittingPurchase ? 'Menyimpan…' : editingPurchase ? 'Simpan Perubahan' : 'Simpan Pembelian'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
