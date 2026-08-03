'use client';

import { useState, useEffect } from 'react';
import {
  Banknote, Plus, Pencil, Trash2, X, Check, Loader2, Search,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, TrendingDown, CalendarDays, Wallet,
} from 'lucide-react';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import FilterSelect from '@/components/FilterSelect';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';
const HEADER_BTN_H = 34;

const EXPENSE_CATEGORIES = ['Sewa', 'Gaji', 'Listrik & Air', 'Transportasi', 'Perlengkapan', 'Bahan Baku', 'Produksi', 'Susut/Rusak', 'Lainnya'];

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateDisplay(iso: string) {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

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

interface Expense {
  id: string; category: string; description: string; amount: number; date: string; note: string;
  sourceType?: string; createdAt?: { seconds: number };
}

const SOURCE_LOCK_MESSAGE: Record<string, string> = {
  'material-purchase': 'Entri ini otomatis dari Pembelian Bahan Baku — edit atau hapus dari menu Bahan Baku > Pembelian.',
};

type ExpenseForm = { category: string; categoryCustom: string; description: string; amount: string; date: string; note: string };
const emptyForm = (): ExpenseForm => ({ category: 'Sewa', categoryCustom: '', description: '', amount: '', date: todayISO(), note: '' });

export default function ExpensesTab({ creds }: { creds: string }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };

  const [expenses,    setExpenses]    = useState<Expense[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [search,      setSearch]      = useState('');
  const [categoryFilter, setCategoryFilter] = useState('semua');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('expenses');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [editing,    setEditing]    = useState<{ id: string } & ExpenseForm | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/expenses`, { headers });
    if (r.ok) { const { expenses: e } = await r.json() as { expenses: Expense[] }; setExpenses(e); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditing({ id: '', ...emptyForm() }); setIsNew(true); setError(''); };
  const openEdit = (e: Expense) => {
    if (e.sourceType && SOURCE_LOCK_MESSAGE[e.sourceType]) { toast.error(SOURCE_LOCK_MESSAGE[e.sourceType]); return; }
    const known = EXPENSE_CATEGORIES.includes(e.category);
    setEditing({
      id: e.id, category: known ? e.category : 'Lainnya', categoryCustom: known ? '' : e.category,
      description: e.description, amount: String(e.amount), date: e.date, note: e.note,
    });
    setIsNew(false); setError('');
  };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    const finalCategory = editing.category === 'Lainnya' && editing.categoryCustom.trim() ? editing.categoryCustom.trim() : editing.category;
    const amountNum = parseFloat(editing.amount) || 0;
    if (!editing.description.trim()) { setError('Keterangan wajib diisi.'); return; }
    if (amountNum <= 0) { setError('Jumlah harus lebih dari 0.'); return; }
    if (!editing.date) { setError('Tanggal wajib diisi.'); return; }
    setSaving(true); setError('');
    const payload = { category: finalCategory, description: editing.description.trim(), amount: amountNum, date: editing.date, note: editing.note };
    const r = isNew
      ? await fetch(`${API}/api/expenses`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/expenses/${editing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Pengeluaran berhasil dicatat.' : 'Pengeluaran berhasil diperbarui.');
    } else {
      toast.error('Gagal menyimpan pengeluaran.');
      setError('Gagal menyimpan pengeluaran.');
    }
    setSaving(false);
  };

  const del = async (e: Expense) => {
    if (e.sourceType && SOURCE_LOCK_MESSAGE[e.sourceType]) { toast.error(SOURCE_LOCK_MESSAGE[e.sourceType]); return; }
    if (!await confirm({ message: `Hapus pengeluaran "${e.description}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(e.id);
    const r = await fetch(`${API}/api/expenses/${e.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      setSelected(s => { const n = new Set(s); n.delete(e.id); return n; });
      toast.success('Pengeluaran berhasil dihapus.');
    } else {
      const d = await r.json().catch(() => ({})) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus pengeluaran.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    const lockedCount = expenses.filter(e => selected.has(e.id) && e.sourceType).length;
    if (!await confirm({
      message: `Hapus ${selected.size} pengeluaran yang dipilih?${lockedCount > 0 ? ` ${lockedCount} di antaranya otomatis dari sumber lain dan akan dilewati.` : ''} Tindakan ini tidak bisa dibatalkan.`,
      danger: true,
    })) return;
    setBulkDeleting(true);
    const r = await fetch(`${API}/api/expenses/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number; skipped: number };
      await load();
      setSelected(new Set());
      toast.success(`${d.deleted} pengeluaran berhasil dihapus.${d.skipped > 0 ? ` ${d.skipped} dilewati karena otomatis dari sumber lain.` : ''}`);
    } else {
      toast.error('Gagal menghapus pengeluaran yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Ringkasan (hari ini / bulan ini / total) ─────────────────
  const todayKey = todayISO();
  const monthKey = todayKey.slice(0, 7);
  const totalToday = expenses.filter(e => e.date === todayKey).reduce((s, e) => s + e.amount, 0);
  const totalMonth = expenses.filter(e => e.date?.startsWith(monthKey)).reduce((s, e) => s + e.amount, 0);
  const totalAll   = expenses.reduce((s, e) => s + e.amount, 0);

  const categoryOptions = [
    { value: 'semua', label: 'Semua Kategori' },
    ...[...new Set([...EXPENSE_CATEGORIES, ...expenses.map(e => e.category)])].map(c => ({ value: c, label: c })),
  ];

  const filtered = expenses
    .filter(e => {
      const matchCat = categoryFilter === 'semua' || e.category === categoryFilter;
      const matchQ = !search
        || e.description.toLowerCase().includes(search.toLowerCase())
        || e.category.toLowerCase().includes(search.toLowerCase())
        || (e.note ?? '').toLowerCase().includes(search.toLowerCase());
      return matchCat && matchQ;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const togglePageAll = () => {
    const pageIds     = paginated.map(e => e.id);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: <CalendarDays size={16} />, label: 'Pengeluaran Hari Ini', val: totalToday, color: 'var(--danger)', bg: 'var(--danger-bg)' },
          { icon: <Wallet       size={16} />, label: 'Pengeluaran Bulan Ini', val: totalMonth, color: 'var(--accent)', bg: 'var(--accent-bg)' },
          { icon: <TrendingDown size={16} />, label: 'Total Semua Pengeluaran', val: totalAll, color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
        ].map((c, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: c.bg, color: c.color }}>
              {c.icon}
            </div>
            <div>
              <p className="text-lg font-extrabold tabular leading-none" style={{ color: c.color }}>{formatRp(c.val)}</p>
              <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Header: search + actions in one row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {expenses.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }}
              placeholder="Cari keterangan, kategori, atau catatan…"
            />
          </div>
        )}
        {expenses.length > 0 && (
          <div style={{ width: 200 }} className="flex-shrink-0">
            <FilterSelect
              value={categoryFilter}
              onChange={v => { setCategoryFilter(v); resetPage(); }}
              height={HEADER_BTN_H}
              searchPlaceholder="Cari kategori…"
              options={categoryOptions}
            />
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap sm:justify-end flex-shrink-0">
          {expenses.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
          <button onClick={openNew} className="btn-primary text-xs" style={{ height: HEADER_BTN_H }}>
            <Plus size={13} /> <span className="hidden sm:inline">Catat Pengeluaran</span><span className="sm:hidden">Tambah</span>
          </button>
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">💸</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada pengeluaran tercatat</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Klik &quot;Catat Pengeluaran&quot; untuk mencatat biaya operasional pertama (sewa, gaji, listrik, dll).
          </p>
        </div>
      ) : (
        <>
          {paginated.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
              <Checkbox
                checked={paginated.every(e => selected.has(e.id))}
                indeterminate={paginated.some(e => selected.has(e.id)) && !paginated.every(e => selected.has(e.id))}
                onChange={togglePageAll}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} pengeluaran di halaman ini`}
              </span>
            </div>
          )}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada pengeluaran yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((e, idx) => {
                const isDeleting = deletingId === e.id;
                const isSelected = selected.has(e.id);
                return (
                  <div key={e.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, transition: 'background 0.1s' }}>
                    <div className="flex items-center gap-2 px-4 py-3.5">
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(e.id)} />
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                        <Banknote size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{e.description}</p>
                          <span className="badge badge-gray text-[10px]">{e.category}</span>
                          {e.sourceType && <span className="badge badge-blue text-[10px]">Otomatis</span>}
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(e.date)}</p>
                      </div>
                      <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--danger)' }}>−{formatRp(e.amount)}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => openEdit(e)} className="btn-ghost p-2" style={{ color: e.sourceType ? 'var(--text-muted)' : 'var(--accent)' }}>
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => del(e)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: e.sourceType ? 'var(--text-muted)' : 'var(--danger)' }}>
                          {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                        {e.note && (
                          <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)} className="btn-ghost p-2">
                            {expandedId === e.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedId === e.id && e.note && (
                      <div className="px-4 pb-4 pt-1" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Catatan</p>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{e.note}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(e => {
                const isDeleting = deletingId === e.id;
                const isSelected = selected.has(e.id);
                return (
                  <div key={e.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(e.id)} />
                    </div>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                        <Banknote size={20} />
                      </div>
                      <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{e.description}</p>
                      <div className="flex items-center gap-1">
                        <span className="badge badge-gray text-[10px]">{e.category}</span>
                        {e.sourceType && <span className="badge badge-blue text-[10px]">Otomatis</span>}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(e.date)}</p>
                      <p className="text-base font-extrabold tabular mt-1" style={{ color: 'var(--danger)' }}>−{formatRp(e.amount)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      {e.note ? (
                        <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)} className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                          Catatan {expandedId === e.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      ) : <span />}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => openEdit(e)} className="btn-ghost p-1.5" style={{ color: e.sourceType ? 'var(--text-muted)' : 'var(--accent)' }}>
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => del(e)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: e.sourceType ? 'var(--text-muted)' : 'var(--danger)' }}>
                          {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    </div>
                    {expandedId === e.id && e.note && (
                      <div className="px-4 pb-4 pt-1" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{e.note}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filtered.length} pengeluaran · halaman {safePage} dari {totalPages}
                </p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); resetPage(); }} />
              </div>
              {totalPages > 1 && (
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
                            style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                            {n}
                          </button>
                    )
                  }
                  <button onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{selected.size} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={bulkDelete} disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--danger)', color: '#fff' }}>
              {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {editing && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Banknote size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Catat Pengeluaran' : 'Edit Pengeluaran'}</p>
                  <p className="modal-subtitle">{isNew ? 'Simpan biaya operasional baru' : `Edit: ${editing.description}`}</p>
                </div>
              </div>
              <button onClick={closeEdit} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Kategori</label>
                    <select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} className="input">
                      {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Tanggal <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} className="input" />
                  </div>
                </div>

                {editing.category === 'Lainnya' && (
                  <div>
                    <label className="field-label">Sebutkan Kategori</label>
                    <input value={editing.categoryCustom} onChange={e => setEditing({ ...editing, categoryCustom: e.target.value })}
                      className="input" placeholder="cth: Kemasan, Ongkir, dll" />
                  </div>
                )}

                <div>
                  <label className="field-label">Keterangan <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}
                    className="input" placeholder="cth: Sewa toko bulan Agustus" autoFocus />
                </div>

                <div>
                  <label className="field-label">Jumlah (Rp) <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="number" min="0" value={editing.amount} onChange={e => setEditing({ ...editing, amount: e.target.value })}
                    className="input" placeholder="0" />
                </div>

                <div>
                  <label className="field-label">Catatan (opsional)</label>
                  <textarea value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })}
                    className="input" style={{ resize: 'vertical', minHeight: 70 }} placeholder="Catatan tambahan" />
                </div>

                {error && (
                  <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={save} disabled={saving} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Pengeluaran'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
