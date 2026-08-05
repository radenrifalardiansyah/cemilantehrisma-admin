'use client';

import { useState, useEffect } from 'react';
import {
  Coins, Plus, Pencil, Trash2, X, Check, Loader2, Search, FileSpreadsheet,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, TrendingUp, CalendarDays, Wallet,
  ShoppingCart, Globe, Store, Lock,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import FilterSelect from '@/components/FilterSelect';
import PageSizeSelect from '@/components/PageSizeSelect';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';
const HEADER_BTN_H = 34;

const INCOME_CATEGORIES = ['Penjualan Lain', 'Komisi', 'Refund/Retur Diterima', 'Bunga Bank', 'Klaim Asuransi', 'Lainnya'];

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

// `auto` menandai baris yang bukan entri manual — hasil sinkronisasi dari data yang sudah ada
// di menu Pesanan (kasir/online) & Mitra (rekap konsinyasi), supaya menu ini menampilkan SEMUA
// uang masuk, bukan cuma pemasukan lain-lain. Baris `auto` read-only (edit/hapus lewat sumbernya).
type AutoSource = 'kasir' | 'online' | 'konsinyasi';

interface Income {
  id: string; category: string; description: string; amount: number; date: string; note: string;
  createdAt?: { seconds: number };
  auto?: AutoSource;
}

interface OrderForIncome {
  id: string; invoiceNo?: string; customerName?: string; total?: number;
  source?: 'kasir' | 'portal'; status?: string; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAt?: { seconds: number } | null;
}
interface RecapForIncome {
  id: string; locationName?: string; totalRevenue?: number;
  paymentStatus?: 'lunas' | 'belum_lunas'; createdAt?: { seconds: number } | null;
}

const AUTO_ICON: Record<AutoSource, typeof ShoppingCart> = { kasir: ShoppingCart, online: Globe, konsinyasi: Store };
function AutoAvatar({ source, size = 16 }: { source: AutoSource; size?: number }) {
  const Icon = AUTO_ICON[source];
  return <Icon size={size} />;
}
const AUTO_LOCK_MESSAGE: Record<AutoSource, string> = {
  kasir: 'Ini penjualan kasir — edit/hapus dari menu Pesanan.',
  online: 'Ini pesanan online — edit/hapus dari menu Pesanan.',
  konsinyasi: 'Ini rekap konsinyasi — edit/hapus dari menu Mitra.',
};

type IncomeForm = { category: string; categoryCustom: string; description: string; amount: string; date: string; note: string };
const emptyForm = (): IncomeForm => ({ category: 'Penjualan Lain', categoryCustom: '', description: '', amount: '', date: todayISO(), note: '' });

export default function IncomeTab({ creds }: { creds: string }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };

  const [income,      setIncome]      = useState<Income[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [search,      setSearch]      = useState('');
  const [categoryFilter, setCategoryFilter] = useState('semua');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(10);
  const [view, setView] = useViewMode('income');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [editing,    setEditing]    = useState<{ id: string } & IncomeForm | null>(null);
  const [isNew,      setIsNew]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error,      setError]      = useState('');
  const [exporting,  setExporting]  = useState(false);

  const load = async () => {
    setLoading(true);
    // Rentang lebar supaya bypass limit 50 default di /api/orders & /api/consignment/recap
    // (limit itu cuma berlaku kalau from/to kosong) — di sini kita memang mau semua riwayat.
    const qs = `from=2000-01-01&to=${todayISO()}`;
    const [iRes, oRes, rRes] = await Promise.all([
      fetch(`${API}/api/income`, { headers }),
      fetch(`${API}/api/orders?${qs}`, { headers }),
      fetch(`${API}/api/consignment/recap?${qs}`, { headers }),
    ]);
    const manual: Income[] = iRes.ok ? (await iRes.json() as { income: Income[] }).income : [];
    const orders: OrderForIncome[] = oRes.ok ? (await oRes.json() as { orders: OrderForIncome[] }).orders : [];
    const recaps: RecapForIncome[] = rRes.ok ? (await rRes.json() as { recaps: RecapForIncome[] }).recaps : [];

    // Sama persis dengan definisi "uang masuk terhitung" di Laporan Keuangan — pesanan online
    // yang belum dikonfirmasi ('baru'), belum lunas, atau dibatalkan tidak ikut dihitung.
    const countedOrders = orders.filter(o =>
      (o.source !== 'portal' || o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
    const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');
    const dateOf = (c?: { seconds: number } | null) => c?.seconds ? new Date(c.seconds * 1000).toISOString().slice(0, 10) : todayISO();

    const fromOrders: Income[] = countedOrders.map(o => ({
      id: `order-${o.id}`,
      category: o.source === 'portal' ? 'Penjualan Online' : 'Penjualan Kasir',
      description: `${o.source === 'portal' ? 'Online' : 'Kasir'} - ${o.invoiceNo || o.customerName || ''}`,
      amount: o.total ?? 0, date: dateOf(o.createdAt),
      note: `Otomatis dari pesanan ${o.source === 'portal' ? 'online' : 'kasir'}${o.invoiceNo ? ` (Invoice ${o.invoiceNo})` : ''}${o.customerName ? ` — ${o.customerName}` : ''}.`,
      auto: o.source === 'portal' ? 'online' : 'kasir',
    }));
    const fromRecaps: Income[] = countedRecaps.map(r => ({
      id: `recap-${r.id}`,
      category: 'Pendapatan Konsinyasi',
      description: `Konsinyasi - ${r.locationName ?? ''}`,
      amount: r.totalRevenue ?? 0, date: dateOf(r.createdAt),
      note: `Otomatis dari rekap konsinyasi${r.locationName ? ` di ${r.locationName}` : ''}.`,
      auto: 'konsinyasi',
    }));

    setIncome([...manual, ...fromOrders, ...fromRecaps]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditing({ id: '', ...emptyForm() }); setIsNew(true); setError(''); };
  const openEdit = (i: Income) => {
    if (i.auto) { toast.error(AUTO_LOCK_MESSAGE[i.auto]); return; }
    const known = INCOME_CATEGORIES.includes(i.category);
    setEditing({
      id: i.id, category: known ? i.category : 'Lainnya', categoryCustom: known ? '' : i.category,
      description: i.description, amount: String(i.amount), date: i.date, note: i.note,
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
      ? await fetch(`${API}/api/income`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/income/${editing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Pemasukan berhasil dicatat.' : 'Pemasukan berhasil diperbarui.');
    } else {
      toast.error('Gagal menyimpan pemasukan.');
      setError('Gagal menyimpan pemasukan.');
    }
    setSaving(false);
  };

  const del = async (i: Income) => {
    if (i.auto) { toast.error(AUTO_LOCK_MESSAGE[i.auto]); return; }
    if (!await confirm({ message: `Hapus pemasukan "${i.description}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(i.id);
    const r = await fetch(`${API}/api/income/${i.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      setSelected(s => { const n = new Set(s); n.delete(i.id); return n; });
      toast.success('Pemasukan berhasil dihapus.');
    } else {
      toast.error('Gagal menghapus pemasukan.');
    }
    setDeletingId(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirm({ message: `Hapus ${selected.size} pemasukan yang dipilih? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setBulkDeleting(true);
    const r = await fetch(`${API}/api/income/bulk-delete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    if (r.ok) {
      const d = await r.json() as { deleted: number };
      await load();
      setSelected(new Set());
      toast.success(`${d.deleted} pemasukan berhasil dihapus.`);
    } else {
      toast.error('Gagal menghapus pemasukan yang dipilih.');
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id: string) => {
    if (income.find(i => i.id === id)?.auto) return;
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ── Ringkasan (hari ini / bulan ini / total) ─────────────────
  const todayKey = todayISO();
  const monthKey = todayKey.slice(0, 7);
  const totalToday = income.filter(i => i.date === todayKey).reduce((s, i) => s + i.amount, 0);
  const totalMonth = income.filter(i => i.date?.startsWith(monthKey)).reduce((s, i) => s + i.amount, 0);
  const totalAll   = income.reduce((s, i) => s + i.amount, 0);

  const categoryOptions = [
    { value: 'semua', label: 'Semua Kategori' },
    ...[...new Set([...INCOME_CATEGORIES, ...income.map(i => i.category)])].map(c => ({ value: c, label: c })),
  ];

  const filtered = income
    .filter(i => {
      const matchCat = categoryFilter === 'semua' || i.category === categoryFilter;
      const matchQ = !search
        || i.description.toLowerCase().includes(search.toLowerCase())
        || i.category.toLowerCase().includes(search.toLowerCase())
        || (i.note ?? '').toLowerCase().includes(search.toLowerCase());
      return matchCat && matchQ;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage     = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const resetPage  = () => setPage(1);

  const togglePageAll = () => {
    const pageIds     = paginated.filter(i => !i.auto).map(i => i.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else             pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const exportExcel = async (rows: Income[], label: string) => {
    if (rows.length === 0) { toast.error('Tidak ada pemasukan untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Pemasukan');
      ws.columns = [
        { key: 'tgl', width: 16 }, { key: 'kat', width: 18 }, { key: 'ket', width: 32 },
        { key: 'jml', width: 18 }, { key: 'catatan', width: 32 },
      ];

      ws.mergeCells(1, 1, 1, 5);
      const t = ws.getCell(1, 1);
      t.value = 'DAFTAR PEMASUKAN LAIN-LAIN — CEMILAN TEH RISMA';
      t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, 5);
      const s = ws.getCell(2, 1);
      s.value = `${rows.length} pemasukan (${label})`;
      s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      s.alignment = { horizontal: 'center', vertical: 'middle' };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const headerRow = ws.getRow(3);
      ['Tanggal', 'Kategori', 'Keterangan', 'Jumlah', 'Catatan'].forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];

      rows.forEach((i, idx) => {
        const rowNum = 4 + idx;
        const row = ws.getRow(rowNum);
        row.getCell(1).value = formatDateDisplay(i.date);
        row.getCell(2).value = i.category;
        row.getCell(3).value = i.description;
        row.getCell(4).value = i.amount;
        row.getCell(4).numFmt = '"Rp"#,##0';
        row.getCell(5).value = i.note ?? '';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pemasukan-${todayISO()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${rows.length} pemasukan ke Excel.`);
    } finally { setExporting(false); }
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
          { icon: <CalendarDays size={16} />, label: 'Pemasukan Hari Ini', val: totalToday, color: 'var(--success)', bg: 'var(--success-bg)' },
          { icon: <Wallet       size={16} />, label: 'Pemasukan Bulan Ini', val: totalMonth, color: 'var(--accent)', bg: 'var(--accent-bg)' },
          { icon: <TrendingUp   size={16} />, label: 'Total Semua Pemasukan', val: totalAll, color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
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
        {income.length > 0 && (
          <div className="w-full sm:w-[200px] flex-shrink-0">
            <FilterSelect
              value={categoryFilter}
              onChange={v => { setCategoryFilter(v); resetPage(); }}
              height={HEADER_BTN_H}
              searchPlaceholder="Cari kategori…"
              options={categoryOptions}
            />
          </div>
        )}
        {income.length > 0 && (
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
        <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0 w-full sm:w-auto">
          <div className="flex items-center gap-2 flex-wrap">
            {income.length > 0 && (
              <Tooltip label="Export Excel">
                <button onClick={() => exportExcel(filtered, 'sesuai filter')} disabled={exporting} aria-label="Export Excel"
                  className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
                </button>
              </Tooltip>
            )}
            {income.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
          </div>
          <button onClick={openNew} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
            <Plus size={13} /> <span className="hidden sm:inline">Catat Pemasukan</span><span className="sm:hidden">Tambah</span>
          </button>
        </div>
      </div>

      {income.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">💰</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada pemasukan tercatat</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Penjualan kasir/online & rekap konsinyasi akan otomatis muncul di sini. Klik &quot;Catat Pemasukan&quot;
            untuk menambah pemasukan di luar penjualan (komisi, refund, bunga bank, dll).
          </p>
        </div>
      ) : (
        <>
          {paginated.length > 0 && (() => {
            const selectableIds = paginated.filter(i => !i.auto).map(i => i.id);
            return (
              <div className="flex items-center gap-3 px-4 py-2.5 card" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
                <Checkbox
                  checked={selectableIds.length > 0 && selectableIds.every(id => selected.has(id))}
                  indeterminate={selectableIds.some(id => selected.has(id)) && !selectableIds.every(id => selected.has(id))}
                  onChange={togglePageAll}
                />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selected.size > 0 ? `${selected.size} dipilih` : `${paginated.length} pemasukan di halaman ini`}
                </span>
              </div>
            );
          })()}

          {paginated.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada pemasukan yang cocok.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              {paginated.map((i, idx) => {
                const isDeleting = deletingId === i.id;
                const isSelected = selected.has(i.id);
                return (
                  <div key={i.id} style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, background: isSelected ? 'rgba(212,105,30,0.05)' : undefined, transition: 'background 0.1s' }}>
                    <div className="flex items-center gap-2 px-4 py-3.5">
                      {i.auto
                        ? <Lock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, width: 18 }} />
                        : <Checkbox checked={isSelected} onChange={() => toggleSelect(i.id)} />}
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                        {i.auto ? <AutoAvatar source={i.auto} /> : <Coins size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{i.description}</p>
                          <span className="badge badge-gray text-[10px]">{i.category}</span>
                          {i.auto && <span className="badge badge-blue text-[10px]">Otomatis</span>}
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(i.date)}</p>
                      </div>
                      <span className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--success)' }}>+{formatRp(i.amount)}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!i.auto && (
                          <>
                            <button onClick={() => openEdit(i)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}>
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => del(i)} disabled={isDeleting} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                              {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </>
                        )}
                        {i.note && (
                          <button onClick={() => setExpandedId(expandedId === i.id ? null : i.id)} className="btn-ghost p-2">
                            {expandedId === i.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedId === i.id && i.note && (
                      <div className="px-4 pb-4 pt-1" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Catatan</p>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{i.note}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paginated.map(i => {
                const isDeleting = deletingId === i.id;
                const isSelected = selected.has(i.id);
                return (
                  <div key={i.id} className="card overflow-hidden relative" style={{ outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }}>
                    <div className="absolute top-3 left-3 z-10 rounded-md p-0.5" style={{ background: 'var(--surface)' }}>
                      {i.auto
                        ? <Lock size={13} style={{ color: 'var(--text-muted)', display: 'block', margin: 2.5 }} />
                        : <Checkbox checked={isSelected} onChange={() => toggleSelect(i.id)} />}
                    </div>
                    <div className="pt-8 pb-3 px-4 flex flex-col items-center text-center gap-1">
                      <div className="w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                        {i.auto ? <AutoAvatar source={i.auto} size={20} /> : <Coins size={20} />}
                      </div>
                      <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{i.description}</p>
                      <div className="flex items-center gap-1">
                        <span className="badge badge-gray text-[10px]">{i.category}</span>
                        {i.auto && <span className="badge badge-blue text-[10px]">Otomatis</span>}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(i.date)}</p>
                      <p className="text-base font-extrabold tabular mt-1" style={{ color: 'var(--success)' }}>+{formatRp(i.amount)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                      {i.note ? (
                        <button onClick={() => setExpandedId(expandedId === i.id ? null : i.id)} className="btn-ghost px-1.5 py-1.5 text-xs font-semibold flex items-center gap-1 flex-shrink-0">
                          Catatan {expandedId === i.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      ) : <span />}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!i.auto && (
                          <>
                            <button onClick={() => openEdit(i)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => del(i)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                              {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {expandedId === i.id && i.note && (
                      <div className="px-4 pb-4 pt-1" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{i.note}</p>
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
                  {filtered.length} pemasukan · halaman {safePage} dari {totalPages}
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
            <button onClick={() => exportExcel(income.filter(i => selected.has(i.id)), 'terpilih')} disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
              Export
            </button>
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
                <div className="modal-icon"><Coins size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Catat Pemasukan' : 'Edit Pemasukan'}</p>
                  <p className="modal-subtitle">{isNew ? 'Simpan pemasukan lain-lain baru' : `Edit: ${editing.description}`}</p>
                </div>
              </div>
              <button onClick={closeEdit} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Kategori</label>
                    <SearchSelect value={editing.category} onChange={v => setEditing({ ...editing, category: v })}
                      options={INCOME_CATEGORIES.map(c => ({ value: c, label: c }))}
                      searchPlaceholder="Cari kategori…" />
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
                      className="input" placeholder="cth: Jual Barang Bekas, Hadiah, dll" />
                  </div>
                )}

                <div>
                  <label className="field-label">Keterangan <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}
                    className="input" placeholder="cth: Komisi jadi reseller produk lain" autoFocus />
                </div>

                <div>
                  <label className="field-label">Jumlah (Rp) <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <NumberInput value={editing.amount} onChange={raw => setEditing({ ...editing, amount: raw })}
                    placeholder="0" />
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
                {saving ? 'Menyimpan…' : 'Simpan Pemasukan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
