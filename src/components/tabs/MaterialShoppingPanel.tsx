'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Loader2, ShoppingCart, Check, Trash2, Pencil, Eye, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import ShoppingListPDF from '@/lib/pdf/ShoppingListPDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useViewMode } from '@/lib/useViewMode';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';

interface ShoppingItem {
  id: string; materialId: string; materialName: string; unit: string;
  qty: number; price: number | null; note: string;
  shoppingDate: string; supplierId?: string; supplierName: string;
  checked: boolean; status: 'pending' | 'done'; purchaseId?: string; doneAt?: string;
  walletId?: string; paymentStatus?: 'lunas' | 'belum_lunas';
}
interface Opt { value: string; label: string; sublabel?: string }

interface Props {
  creds: string;
  materials: { id: string; name: string; unit: string; stockQty: number }[];
  suppliers: { id: string; name: string }[];
  walletOptions: Opt[];
  walletBalances: Record<string, number>;
  /** id dompet → nama, untuk menampilkan dompet yang dipakai pembelian. */
  walletNames: Record<string, string>;
  /** Dipanggil setelah daftar diproses jadi pembelian, supaya induk memuat ulang stok/pembelian/saldo. */
  onProcessed: () => void;
}

// Satu daftar belanja = kumpulan item dengan tanggal + supplier yang sama (otomatis tergabung).
interface ShoppingGroup {
  key: string; date: string; supplierId?: string; supplierName: string;
  items: ShoppingItem[]; pending: ShoppingItem[]; checked: ShoppingItem[];
  total: number; notes: string[]; walletIds: string[]; unpaid: boolean; status: 'menunggu' | 'belanja' | 'sebagian' | 'selesai';
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const formatQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDateLong = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const NO_SUPPLIER = 'Tanpa supplier';
const HEADER_BTN_H = 34;
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };
const thStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' };
const thCls = 'px-3 py-2.5 font-bold uppercase tracking-wide whitespace-nowrap';

// Kotak centang kecil untuk memilih daftar (dipakai cetak PDF banyak tanggal sekaligus).
function SelectBox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} onClick={e => { e.stopPropagation(); onChange(); }}
      className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors"
      style={{ background: checked || indeterminate ? 'var(--accent)' : 'transparent', borderColor: checked || indeterminate ? 'var(--accent)' : 'var(--border)' }}>
      {indeterminate && !checked
        ? <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />
        : checked ? <Check size={11} color="#fff" strokeWidth={3} /> : null}
    </button>
  );
}

interface AddRow { materialId: string; qty: string; price: string }
const EMPTY_ROW: AddRow = { materialId: '', qty: '', price: '' };

const supplierKeyOf = (i: ShoppingItem) => i.supplierId ? `id:${i.supplierId}` : `n:${i.supplierName.trim().toLowerCase()}`;

// Warna bullet supplier mengikuti status daftar.
const STATUS_DOT: Record<ShoppingGroup['status'], string> = {
  menunggu: 'var(--text-muted)', belanja: '#0369A1', sebagian: 'var(--accent)', selesai: 'var(--success)',
};

const STATUS_BADGE: Record<ShoppingGroup['status'], { label: string; cls: string }> = {
  menunggu: { label: 'Menunggu', cls: 'badge-gray' },
  belanja:  { label: 'Sedang belanja', cls: 'badge-blue' },
  sebagian: { label: 'Sebagian', cls: 'badge-amber' },
  selesai:  { label: 'Selesai', cls: 'badge-green' },
};

function buildGroups(items: ShoppingItem[]): ShoppingGroup[] {
  const map = new Map<string, ShoppingItem[]>();
  items.forEach(i => {
    const key = `${i.shoppingDate}|${supplierKeyOf(i)}`;
    map.set(key, [...(map.get(key) ?? []), i]);
  });
  return [...map.entries()].map(([key, list]) => {
    const pending = list.filter(i => i.status === 'pending');
    const done = list.filter(i => i.status === 'done');
    const checked = pending.filter(i => i.checked);
    const status: ShoppingGroup['status'] = pending.length === 0 ? 'selesai' : done.length > 0 ? 'sebagian' : checked.length > 0 ? 'belanja' : 'menunggu';
    return {
      key, date: list[0].shoppingDate, supplierId: list[0].supplierId, supplierName: list[0].supplierName,
      items: list, pending, checked,
      total: list.reduce((s, i) => s + i.qty * (i.price ?? 0), 0),
      notes: [...new Set(list.map(i => i.note.trim()).filter(Boolean))],
      walletIds: [...new Set(done.map(i => i.walletId).filter((w): w is string => !!w))],
      unpaid: done.some(i => i.paymentStatus === 'belum_lunas'),
      status,
    };
  });
}

export default function MaterialShoppingPanel({ creds, materials, suppliers, walletOptions, walletBalances, walletNames, onProcessed }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const storeHeader = useStoreHeader(creds);
  const [view, setView] = useViewMode('material-shopping');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printingDate, setPrintingDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printingSelected, setPrintingSelected] = useState(false);

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Form buat daftar baru
  const [showCreate, setShowCreate] = useState(false);
  const [fDate, setFDate] = useState(todayISO());
  const [fSupplierId, setFSupplierId] = useState('');
  const [fSupplierName, setFSupplierName] = useState('');
  const [fNote, setFNote] = useState('');
  const [rows, setRows] = useState<AddRow[]>([{ ...EMPTY_ROW }]);
  const [saving, setSaving] = useState(false);

  // Detail daftar (centang) & proses
  const [detailKey, setDetailKey] = useState<string | null>(null);
  // Info daftar yang sedang dibuka (diedit di modal yang sama dengan centang item)
  const [dDate, setDDate] = useState('');
  const [dSupplierId, setDSupplierId] = useState('');
  const [dSupplierName, setDSupplierName] = useState('');
  const [dNote, setDNote] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [pDate, setPDate] = useState(todayISO());
  const [walletId, setWalletId] = useState('');
  // Dompet per item (menimpa dompet default); kosong = ikut dompet default.
  const [itemWallets, setItemWallets] = useState<Record<string, string>>({});
  // Hasil proses terakhir (ditampilkan di modal daftar yang sama): satu baris per pembelian yang dibuat.
  const [processResult, setProcessResult] = useState<{ walletId: string; total: number; count: number; status: 'lunas' | 'belum_lunas' }[] | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [pNote, setPNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const load = async () => {
    const r = await fetch(`${API}/api/material-shopping`, { headers });
    if (r.ok) setItems((await r.json() as { items: ShoppingItem[] }).items);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase();
  const allGroups = buildGroups(items);
  const groups = q
    ? allGroups.filter(g => g.supplierName.toLowerCase().includes(q) || g.notes.some(n => n.toLowerCase().includes(q)) || g.items.some(i => i.materialName.toLowerCase().includes(q)))
    : allGroups;

  // Per tanggal (terbaru dulu), di dalamnya dipisah per supplier.
  const byDate = new Map<string, ShoppingGroup[]>();
  groups.forEach(g => byDate.set(g.date, [...(byDate.get(g.date) ?? []), g]));
  const dateBlocks = [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, gs]) => ({
      date,
      groups: gs.slice().sort((a, b) => (a.supplierName || '￿').localeCompare(b.supplierName || '￿')),
      total: gs.reduce((s, g) => s + g.total, 0),
      itemCount: gs.reduce((s, g) => s + g.items.length, 0),
    }));

  // Halaman = kumpulan tanggal (satu tanggal tidak dipecah antar halaman supaya totalnya utuh).
  const totalPages = Math.max(1, Math.ceil(dateBlocks.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedBlocks = dateBlocks.slice((safePage - 1) * pageSize, safePage * pageSize);
  const goPage = (n: number) => setPage(Math.max(1, Math.min(n, totalPages)));

  // Nomor urut per transaksi (satu tanggal = satu nomor), berlanjut antar halaman (terbaru = 1).
  const numberOf = new Map(dateBlocks.map((b, i) => [b.date, i + 1] as const));

  const detail = detailKey ? allGroups.find(g => g.key === detailKey) ?? null : null;
  const materialOptions = materials.map(m => ({ value: m.id, label: m.name, sublabel: `Stok ${formatQty(m.stockQty)} ${m.unit}` }));
  const supplierOptions = [{ value: '', label: '– Toko/warung lain, isi nama di bawah –' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))];
  // Dompet yang dipakai pembelian dari daftar ini (kosong kalau belum ada yang diproses).
  const walletLabel = (g: ShoppingGroup) => g.walletIds.map(id => walletNames[id] ?? 'Dompet dihapus').join(', ') || '-';
  const supplierLabel = (g: { supplierName: string }) => g.supplierName.trim() || NO_SUPPLIER;

  // ── Form buat daftar baru ──
  const openCreate = () => {
    setFDate(todayISO()); setFSupplierId(''); setFSupplierName(''); setFNote('');
    setRows([{ ...EMPTY_ROW }]);
    setShowCreate(true);
  };
  const openDetail = (g: ShoppingGroup) => {
    setDDate(g.date); setDSupplierId(g.supplierId ?? ''); setDSupplierName(g.supplierName); setDNote(g.notes.join(' · '));
    setRows([{ ...EMPTY_ROW }]);
    setItemWallets({}); setPDate(todayISO()); setPNote(g.notes.join(' · ')); setProcessResult(null);
    setDetailKey(g.key);
  };
  const updateRow = (i: number, p: Partial<AddRow>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...p } : r));
  const validRows = rows.filter(r => r.materialId && parseFloat(r.qty) > 0);
  const formTotal = validRows.reduce((t, r) => t + parseFloat(r.qty) * (parseFloat(r.price) || 0), 0);
  const canSave = !!fDate && validRows.length > 0;

  // Nama toko yang sama dengan supplier terdaftar otomatis dianggap supplier itu (supaya tergabung).
  const resolveSupplier = (pickedId: string, typedName: string) => {
    const typed = typedName.trim();
    const matched = pickedId ? undefined : suppliers.find(s => s.name.toLowerCase() === typed.toLowerCase());
    const supplierId = pickedId || matched?.id || '';
    return { supplierId, supplierName: suppliers.find(s => s.id === supplierId)?.name ?? typed };
  };
  const rowsPayload = () => validRows.map(x => ({ materialId: x.materialId, qty: parseFloat(x.qty), price: x.price ? parseFloat(x.price) : null }));

  const saveForm = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/material-shopping`, {
        method: 'POST', headers,
        body: JSON.stringify({ date: fDate, ...resolveSupplier(fSupplierId, fSupplierName), note: fNote, items: rowsPayload() }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal menyimpan daftar belanja.'); return; }
      toast.success(`${validRows.length} item ditambahkan ke daftar belanja.`);
      setShowCreate(false);
      await load();
    } finally { setSaving(false); }
  };

  // Simpan perubahan info daftar (tanggal/supplier/catatan) — kunci daftar ikut berubah, jadi
  // modal dipindahkan ke kunci baru supaya tetap terbuka.
  const saveInfo = async () => {
    if (!detail || !dDate) return;
    setSavingInfo(true);
    try {
      const sup = resolveSupplier(dSupplierId, dSupplierName);
      const r = await fetch(`${API}/api/material-shopping/group`, {
        method: 'PUT', headers, body: JSON.stringify({ date: dDate, ...sup, note: dNote, ids: detail.pending.map(i => i.id) }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal menyimpan info daftar.'); return; }
      toast.success('Info daftar belanja diperbarui.');
      setDetailKey(`${dDate}|${sup.supplierId ? `id:${sup.supplierId}` : `n:${sup.supplierName.trim().toLowerCase()}`}`);
      await load();
    } finally { setSavingInfo(false); }
  };

  // Tambah item baru ke daftar yang sedang dibuka (memakai info daftar yang sudah tersimpan).
  const addToDetail = async () => {
    if (!detail || validRows.length === 0) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/material-shopping`, {
        method: 'POST', headers,
        body: JSON.stringify({ date: detail.date, supplierId: detail.supplierId ?? '', supplierName: detail.supplierName, note: detail.notes.join(' · '), items: rowsPayload() }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal menambah item.'); return; }
      toast.success(`${validRows.length} item ditambahkan.`);
      setRows([{ ...EMPTY_ROW }]);
      await load();
    } finally { setSaving(false); }
  };

  // ── Item di dalam daftar ──
  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`${API}/api/material-shopping/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!r.ok) { toast.error('Gagal menyimpan perubahan.'); load(); }
  };
  const setLocal = (id: string, p: Partial<ShoppingItem>) => setItems(prev => prev.map(i => i.id === id ? { ...i, ...p } : i));
  const toggle = (i: ShoppingItem) => { setLocal(i.id, { checked: !i.checked }); patch(i.id, { checked: !i.checked }); };
  const removeItem = async (i: ShoppingItem) => {
    if (!await confirm({ message: `Hapus "${i.materialName}" dari daftar belanja?`, danger: true })) return;
    setItems(prev => prev.filter(x => x.id !== i.id));
    await fetch(`${API}/api/material-shopping/${i.id}`, { method: 'DELETE', headers });
  };
  const removeGroup = async (g: ShoppingGroup) => {
    if (!await confirm({ message: `Hapus daftar belanja ${supplierLabel(g)} (${formatDateLong(g.date)})? ${g.pending.length} item yang belum dibeli akan dihapus.`, danger: true })) return;
    const r = await fetch(`${API}/api/material-shopping/group`, { method: 'DELETE', headers, body: JSON.stringify({ ids: g.pending.map(i => i.id) }) });
    if (r.ok) { toast.success('Daftar belanja dihapus.'); if (detailKey === g.key) setDetailKey(null); await load(); }
    else toast.error('Gagal menghapus daftar belanja.');
  };

  // ── Proses ──
  const checkedTotal = detail ? detail.checked.reduce((s, i) => s + i.qty * (i.price ?? 0), 0) : 0;
  const missingPrice = detail ? detail.checked.filter(i => !(i.price && i.price > 0)) : [];
  const walletOf = (id: string) => itemWallets[id] || walletId;
  // Total per dompet (satu dompet = satu pembelian) untuk ringkasan & cek saldo.
  const walletTotals = new Map<string, number>();
  detail?.checked.forEach(i => { const w = walletOf(i.id); if (w) walletTotals.set(w, (walletTotals.get(w) ?? 0) + i.qty * (i.price ?? 0)); });
  const canProcess = !!detail && detail.checked.length > 0 && missingPrice.length === 0 && detail.checked.every(i => !!walletOf(i.id)) && !!pDate && !!detail.supplierName.trim();

  const submitProcess = async () => {
    if (!detail || !canProcess) return;
    setProcessing(true);
    // Ringkasan dihitung sebelum item berubah status (per dompet = satu pembelian).
    const summary = [...walletTotals.entries()].map(([w, total]) => ({
      walletId: w, total, count: detail.checked.filter(i => walletOf(i.id) === w).length, status: paymentStatus,
    }));
    try {
      const r = await fetch(`${API}/api/material-shopping/process`, {
        method: 'POST', headers,
        body: JSON.stringify({ ids: detail.checked.map(i => i.id), items: detail.checked.map(i => ({ id: i.id, qty: i.qty, price: i.price })), supplierId: detail.supplierId, supplierName: detail.supplierName.trim(), date: pDate, walletId, itemWallets: Object.fromEntries(detail.checked.filter(i => itemWallets[i.id]).map(i => [i.id, itemWallets[i.id]])), paymentStatus, note: pNote }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal memproses daftar belanja.'); return; }
      toast.success(walletTotals.size > 1 ? `${detail.checked.length} item diproses jadi ${walletTotals.size} pembelian (per dompet).` : `${detail.checked.length} item diproses jadi pembelian bahan baku.`);
      setItemWallets({});
      setProcessResult(summary);
      await load();
      onProcessed();
    } finally { setProcessing(false); }
  };

  // ── Export (semua daftar sesuai filter pencarian, bukan hanya halaman ini) ──
  const exportRows = () => dateBlocks.flatMap(b => [
    ...b.groups.map(g => ({
      kind: 'row' as const, no: numberOf.get(b.date) ?? 0, date: formatDateLong(b.date), supplier: supplierLabel(g),
      items: g.items.map(i => `${i.materialName} (${formatQty(i.qty)} ${i.unit})`).join(', '),
      count: g.items.length, bought: g.items.length - g.pending.length, total: g.total,
      status: STATUS_BADGE[g.status].label, wallet: walletLabel(g), note: g.notes.join(' · ') || '-',
    })),
    { kind: 'subtotal' as const, no: 0, date: formatDateLong(b.date), supplier: 'TOTAL TANGGAL INI', items: '', count: b.itemCount, bought: 0, total: b.total, status: '', wallet: '', note: '' },
  ]);
  const grandTotal = dateBlocks.reduce((t, b) => t + b.total, 0);
  const grandItems = dateBlocks.reduce((t, b) => t + b.itemCount, 0);
  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const exportExcel = async () => {
    if (dateBlocks.length === 0) { toast.error('Tidak ada daftar belanja untuk diexport.'); return; }
    setExportingXlsx(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Daftar Belanja');
      const COLS = [
        { header: 'No', key: 'no', width: 6 }, { header: 'Tanggal', key: 'date', width: 28 }, { header: 'Supplier', key: 'supplier', width: 24 },
        { header: 'Bahan Baku', key: 'items', width: 46 }, { header: 'Jml Item', key: 'count', width: 10 },
        { header: 'Sudah Dibeli', key: 'bought', width: 13 }, { header: 'Perkiraan Total', key: 'total', width: 18 },
        { header: 'Status', key: 'status', width: 16 }, { header: 'Dompet', key: 'wallet', width: 18 }, { header: 'Catatan', key: 'note', width: 28 },
      ];
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));
      ws.mergeCells(1, 1, 1, COLS.length);
      const t = ws.getCell(1, 1);
      t.value = 'DAFTAR BELANJA BAHAN BAKU — CEMILAN TEH RISMA';
      t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;
      ws.mergeCells(2, 1, 2, COLS.length);
      const sub = ws.getCell(2, 1);
      sub.value = `${dateBlocks.length} tanggal · Diexport ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
      sub.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      sub.alignment = { horizontal: 'center', vertical: 'middle' };
      sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      const head = ws.getRow(3);
      COLS.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
      head.height = 24;
      head.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];
      let zebra = 0;
      exportRows().forEach(r => {
        const row = ws.addRow({ no: r.kind === 'row' ? r.no : '', date: r.date, supplier: r.supplier, items: r.items, count: r.count, bought: r.kind === 'row' ? r.bought : '', total: r.total, status: r.status, wallet: r.wallet, note: r.note });
        row.getCell('total').numFmt = '"Rp"#,##0';
        row.getCell('total').alignment = { horizontal: 'right', vertical: 'middle' };
        row.getCell('items').alignment = { vertical: 'top', wrapText: true };
        row.getCell('note').alignment = { vertical: 'top', wrapText: true };
        const sub = r.kind === 'subtotal';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sub ? 'FFFDE8CF' : zebra % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
          if (sub) cell.font = { bold: true };
        });
        if (!sub) zebra++;
      });
      const total = ws.addRow({ date: 'TOTAL SEMUA', count: grandItems, total: grandTotal });
      total.getCell('total').numFmt = '"Rp"#,##0';
      total.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8CF' } };
        cell.border = { top: { style: 'medium', color: { argb: 'FFC96018' } } };
      });
      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `daftar-belanja-cemilantehrisma-${new Date().toLocaleDateString('en-CA')}.xlsx`);
      toast.success('Berhasil export daftar belanja ke Excel.');
    } catch { toast.error('Gagal membuat file Excel.'); }
    finally { setExportingXlsx(false); }
  };

  // Data PDF satu tanggal: per supplier ada tabel item + subtotal, ditutup total tanggal.
  const pdfDataFor = (date: string, gs: ShoppingGroup[]) => ({
    no: numberOf.get(date) ?? 0,
    dateLabel: formatDateLong(date),
    generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    itemCount: gs.reduce((t, g) => t + g.items.length, 0), grandTotal: gs.reduce((t, g) => t + g.total, 0),
    suppliers: gs.slice().sort((a, b) => (a.supplierName || '￿').localeCompare(b.supplierName || '￿')).map(g => ({
      name: supplierLabel(g), notes: g.notes.join(' · '), wallet: walletLabel(g),
      status: STATUS_BADGE[g.status].label + (g.unpaid ? ' (belum lunas)' : ''),
      total: g.total,
      items: g.items.map((i, idx) => ({
        no: idx + 1, name: i.materialName, qty: formatQty(i.qty), unit: i.unit,
        price: i.price, subtotal: i.qty * (i.price ?? 0), bought: i.status === 'done',
      })),
    })),
  });

  const printDatePdf = async (block: { date: string; groups: ShoppingGroup[] }) => {
    setPrintingDate(block.date);
    try {
      const blob = await pdf(<ShoppingListPDF store={storeHeader} data={pdfDataFor(block.date, block.groups)} />).toBlob();
      downloadBlob(blob, `daftar-belanja-${block.date}.pdf`);
      toast.success(`PDF daftar belanja ${formatDateLong(block.date)} berhasil dibuat.`);
    } catch { toast.error('Gagal membuat file PDF.'); }
    finally { setPrintingDate(null); }
  };

  // PDF dari daftar yang dicentang — satu file, tiap tanggal mulai di halaman baru (terlama di depan).
  const picked = allGroups.filter(g => selected.has(g.key));
  const printSelectedPdf = async () => {
    if (picked.length === 0) return;
    setPrintingSelected(true);
    try {
      const byDay = new Map<string, ShoppingGroup[]>();
      picked.forEach(g => byDay.set(g.date, [...(byDay.get(g.date) ?? []), g]));
      const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, gs]) => pdfDataFor(d, gs));
      const blob = await pdf(<ShoppingListPDF store={storeHeader} data={days} />).toBlob();
      downloadBlob(blob, `daftar-belanja-terpilih-${new Date().toLocaleDateString('en-CA')}.pdf`);
      toast.success(`PDF ${picked.length} daftar (${days.length} tanggal) berhasil dibuat.`);
    } catch { toast.error('Gagal membuat file PDF.'); }
    finally { setPrintingSelected(false); }
  };
  const toggleKey = (key: string) => setSelected(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleDate = (gs: ShoppingGroup[]) => setSelected(prev => {
    const n = new Set(prev);
    if (gs.every(g => n.has(g.key))) gs.forEach(g => n.delete(g.key)); else gs.forEach(g => n.add(g.key));
    return n;
  });

  const exportPdf = async () => {
    if (dateBlocks.length === 0) { toast.error('Tidak ada daftar belanja untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const rows = exportRows().map(r => [r.kind === 'row' ? r.no : '', r.date, r.supplier, r.items, r.kind === 'row' ? `${r.bought}/${r.count}` : `${r.count}`, formatRp(r.total), r.status, r.wallet, r.note]);
      rows.push(['', 'TOTAL SEMUA', '', '', `${grandItems}`, formatRp(grandTotal), '', '', '']);
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'DAFTAR BELANJA BAHAN BAKU',
            label: `${dateBlocks.length} tanggal${q ? ' (sesuai pencarian)' : ''}`,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'No', width: '4%', align: 'center' },
              { header: 'Tanggal', width: '12%' },
              { header: 'Supplier', width: '12%' },
              { header: 'Bahan Baku', width: '24%' },
              { header: 'Dibeli', width: '7%', align: 'center' },
              { header: 'Perkiraan Total', width: '12%', align: 'right', bold: true },
              { header: 'Status', width: '8%', align: 'center' },
              { header: 'Dompet', width: '10%' },
              { header: 'Catatan', width: '11%' },
            ],
            rows,
          }}
        />
      ).toBlob();
      downloadBlob(blob, `daftar-belanja-cemilantehrisma-${new Date().toLocaleDateString('en-CA')}.pdf`);
      toast.success('Berhasil export daftar belanja ke PDF.');
    } catch { toast.error('Gagal membuat file PDF.'); }
    finally { setExportingPdf(false); }
  };

  if (loading) return <PageLoader />;

  const rowsEditor = (
    <div>
      <label style={fieldLabel}>Bahan Baku yang Dibeli</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row, i) => {
          const mat = materials.find(m => m.id === row.materialId);
          return (
            <div key={i} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SearchSelect value={row.materialId} onChange={id => updateRow(i, { materialId: id })}
                    options={materialOptions} placeholder="– Bahan baku –" searchPlaceholder="Cari bahan baku…" />
                </div>
                <Tooltip label="Hapus baris">
                  <button onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))} disabled={rows.length === 1}
                    className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}>
                    <X size={14} />
                  </button>
                </Tooltip>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label style={fieldLabel}>{`Qty${mat ? ` (${mat.unit})` : ''}`}</label>
                  <input type="number" min="0" value={row.qty} onChange={e => updateRow(i, { qty: e.target.value })} placeholder="0" className="input" />
                </div>
                <div>
                  <label style={fieldLabel}>Perkiraan harga/satuan</label>
                  <NumberInput value={row.price} onChange={raw => updateRow(i, { price: raw })} placeholder="0" />
                </div>
              </div>
              {parseFloat(row.qty) > 0 && parseFloat(row.price) > 0 && (
                <p className="text-xs tabular mt-2" style={{ color: 'var(--text-muted)' }}>Subtotal: {formatRp(parseFloat(row.qty) * parseFloat(row.price))}</p>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={() => setRows(prev => [...prev, { ...EMPTY_ROW }])} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
        <Plus size={12} /> Tambah Baris Bahan Baku
      </button>
    </div>
  );

  return (
    <>
      <div className="p-4 lg:p-6 animate-fade-up space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          <ShoppingCart size={11} /> Daftar Belanja ({allGroups.length})
        </p>
        <div className="flex flex-row items-center gap-2 sm:gap-3 sm:flex-1">
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input text-sm w-full" style={{ paddingLeft: 38, height: 34 }}
              placeholder="Cari supplier atau bahan baku…" />
          </div>
          {allGroups.length > 0 && (
            <>
              <Tooltip label="Export Excel">
                <button onClick={exportExcel} disabled={exportingXlsx} aria-label="Export Excel"
                  className="btn-ghost p-0 flex items-center justify-center flex-shrink-0" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                </button>
              </Tooltip>
              <Tooltip label="Export PDF">
                <button onClick={exportPdf} disabled={exportingPdf} aria-label="Export PDF"
                  className="btn-ghost p-0 flex items-center justify-center flex-shrink-0" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                </button>
              </Tooltip>
              <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />
            </>
          )}
          <button onClick={openCreate} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
            <Plus size={13} /> <span className="hidden sm:inline">Buat Daftar Belanja</span>
          </button>
        </div>
        </div>

        {allGroups.length === 0 ? (
          <EmptyAddCard label="Buat Daftar Belanja" onClick={openCreate}
            hint="Susun daftar bahan baku yang mau dibeli, lalu centang saat sudah dibeli" />
        ) : dateBlocks.length === 0 ? (
          <p className="text-sm text-center py-10" style={{ color: 'var(--text-muted)' }}>Tidak ada daftar belanja yang cocok.</p>
        ) : (
          <>
            {pagedBlocks.map(block => (
              <div key={block.date} className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-3">
                    <SelectBox label="Pilih semua supplier di tanggal ini"
                      checked={block.groups.every(g => selected.has(g.key))}
                      indeterminate={block.groups.some(g => selected.has(g.key)) && !block.groups.every(g => selected.has(g.key))}
                      onChange={() => toggleDate(block.groups)} />
                    <div>
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{numberOf.get(block.date)}.</span> {formatDateLong(block.date)}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{block.groups.length} supplier · {block.itemCount} item</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>Total {formatRp(block.total)}</p>
                    <Tooltip label="Cetak PDF tanggal ini">
                      <button onClick={() => printDatePdf(block)} disabled={printingDate === block.date} aria-label="Cetak PDF tanggal ini"
                        className="btn-ghost p-0 flex items-center justify-center flex-shrink-0" style={{ height: 30, width: 30 }}>
                        {printingDate === block.date ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
                      </button>
                    </Tooltip>
                  </div>
                </div>
                {view === 'table' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-xs table-fixed" style={{ borderCollapse: 'collapse' }}>
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 110 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className={thCls} style={thStyle} />
                    <th className={`${thCls} text-left`} style={thStyle}>Supplier</th>
                    <th className={`${thCls} text-right`} style={thStyle}>Item</th>
                    <th className={`${thCls} text-right`} style={thStyle}>Perkiraan Total</th>
                    <th className={`${thCls} text-left`} style={thStyle}>Status</th>
                    <th className={`${thCls} text-left`} style={thStyle}>Dompet</th>
                    <th className={`${thCls} text-right`} style={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {block.groups.map(g => {
                    const doneCount = g.items.length - g.pending.length;
                    return (
                      <tr key={g.key} onClick={() => openDetail(g)} className="cursor-pointer" style={{ borderBottom: '1px solid var(--border-2)', background: selected.has(g.key) ? 'var(--accent-bg)' : undefined }}>
                        <td className="pl-3 py-2.5"><SelectBox label="Pilih daftar ini" checked={selected.has(g.key)} onChange={() => toggleKey(g.key)} /></td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>
                          <p className="font-semibold flex items-start gap-1.5"><span style={{ color: STATUS_DOT[g.status] }}>•</span> <span className="min-w-0">{supplierLabel(g)}</span></p>
                          {g.notes.length > 0 && <p className="text-[10.5px] truncate pl-3.5" style={{ color: 'var(--text-muted)' }}>{g.notes.join(' · ')}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{doneCount}/{g.items.length} dibeli</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{formatRp(g.total)}</td>
                        <td className="px-3 py-2.5"><span className={`badge ${STATUS_BADGE[g.status].cls}`}>{STATUS_BADGE[g.status].label}</span></td>
                        <td className="px-3 py-2.5 break-words" style={{ color: 'var(--text-secondary)' }}>
                          {walletLabel(g)}{g.unpaid && <span className="block text-[10.5px]" style={{ color: 'var(--danger)' }}>Belum lunas</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <Tooltip label={g.pending.length > 0 ? 'Buka, centang & edit' : 'Lihat'}>
                              <button onClick={() => openDetail(g)} className="btn-ghost p-2">{g.pending.length > 0 ? <Pencil size={14} /> : <Eye size={14} />}</button>
                            </Tooltip>
                            {g.pending.length > 0 && (
                              <Tooltip label="Hapus daftar">
                                  <button onClick={() => removeGroup(g)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                                </Tooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <td />
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>Total semua supplier</td>
                    <td className="px-3 py-2.5 text-right font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{block.itemCount} item</td>
                    <td className="px-3 py-2.5 text-right font-extrabold tabular whitespace-nowrap" style={{ color: 'var(--accent)' }}>{formatRp(block.total)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                    {block.groups.map(g => {
                      const doneCount = g.items.length - g.pending.length;
                      return (
                        <div key={g.key} onClick={() => openDetail(g)} className="card p-3.5 flex flex-col gap-2 cursor-pointer" style={{ borderColor: selected.has(g.key) ? 'var(--accent)' : 'var(--border-2)', background: selected.has(g.key) ? 'var(--accent-bg)' : undefined }}>
                          <div className="flex items-start justify-between gap-2">
                            <SelectBox label="Pilih daftar ini" checked={selected.has(g.key)} onChange={() => toggleKey(g.key)} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}><span style={{ color: STATUS_DOT[g.status] }}>•</span> {supplierLabel(g)}</p>
                              {g.notes.length > 0 && <p className="text-[10.5px] truncate" style={{ color: 'var(--text-muted)' }}>{g.notes.join(' · ')}</p>}
                            </div>
                            <span className={`badge ${STATUS_BADGE[g.status].cls} flex-shrink-0`}>{STATUS_BADGE[g.status].label}</span>
                          </div>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{doneCount}/{g.items.length} item dibeli{g.walletIds.length > 0 ? ` · ${walletLabel(g)}${g.unpaid ? ' (belum lunas)' : ''}` : ''}</p>
                          <p className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(g.total)}</p>
                          <div className="flex items-center justify-end gap-1 pt-2" style={{ borderTop: '1px solid var(--border-2)' }} onClick={e => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1">
                            <Tooltip label={g.pending.length > 0 ? 'Buka, centang & edit' : 'Lihat'}>
                              <button onClick={() => openDetail(g)} className="btn-ghost p-2">{g.pending.length > 0 ? <Pencil size={14} /> : <Eye size={14} />}</button>
                            </Tooltip>
                            {g.pending.length > 0 && (
                              <Tooltip label="Hapus daftar">
                                  <button onClick={() => removeGroup(g)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                                </Tooltip>
                            )}
                          </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            <div className="card px-4 py-3 flex items-center justify-between" style={{ background: 'var(--accent-bg)' }}>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total semua ({dateBlocks.length} tanggal · {grandItems} item)</span>
              <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(grandTotal)}</span>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {dateBlocks.length} tanggal · {groups.length} daftar · halaman {safePage} dari {totalPages}
                </p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); setPage(1); }} />
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Tooltip label="Halaman sebelumnya">
                    <button onClick={() => goPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft size={14} /></button>
                  </Tooltip>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                    .reduce<(number | '…')[]>((acc, n, i, arr) => {
                      if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(n); return acc;
                    }, [])
                    .map((n, i) =>
                      n === '…'
                        ? <span key={`e${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
                        : <button key={n} onClick={() => goPage(n as number)} className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                            style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                            {n}
                          </button>
                    )}
                  <Tooltip label="Halaman berikutnya">
                    <button onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30"><ChevronRight size={14} /></button>
                  </Tooltip>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal & bilah di luar wadah beranimasi (transform) supaya `fixed` relatif ke viewport */}

      {/* Bilah aksi untuk daftar yang dicentang */}
      {picked.length > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 z-40 bulk-action-bar">
          <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl shadow-xl overflow-x-auto no-scrollbar animate-fade-up"
            style={{ background: 'var(--text-primary)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <span className="text-sm font-bold flex-shrink-0 whitespace-nowrap">{picked.length} dipilih</span>
            <div className="w-px h-4 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <button onClick={printSelectedPdf} disabled={printingSelected}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              {printingSelected ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              Cetak PDF
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs font-medium opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 whitespace-nowrap px-1">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Detail daftar: info + centang item + tambah item, dalam satu modal */}
      {detail && (
        <div className="modal-overlay" onClick={() => !processing && setDetailKey(null)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingCart size={17} /></div>
                <div>
                  <p className="modal-title">{supplierLabel(detail)}</p>
                  <p className="modal-subtitle">{formatDateLong(detail.date)} · {detail.items.length - detail.pending.length}/{detail.items.length} item dibeli{detail.walletIds.length > 0 ? ` · Dompet: ${walletLabel(detail)}${detail.unpaid ? ' (belum lunas)' : ''}` : ''}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setDetailKey(null)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Hasil proses terakhir */}
                {processResult && (
                  <div className="p-3 rounded-xl space-y-1.5" style={{ background: 'var(--success-bg)', border: '1px solid var(--success)' }}>
                    <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
                      <Check size={15} /> {processResult.length > 1 ? `${processResult.length} pembelian berhasil dibuat` : 'Pembelian berhasil dibuat'}
                    </p>
                    {processResult.map(r => (
                      <div key={r.walletId} className="flex justify-between gap-3 text-xs">
                        <span style={{ color: 'var(--text-secondary)' }}>{r.count} item · Dompet {walletNames[r.walletId] ?? '-'} · {r.status === 'lunas' ? 'Lunas' : 'Belum Lunas'}</span>
                        <span className="font-bold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(r.total)}</span>
                      </div>
                    ))}
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Stok dan harga rata-rata bahan baku sudah diperbarui. Lihat di tab Pembelian.</p>
                  </div>
                )}

                {/* Info daftar */}
                {detail.pending.length > 0 ? (
                  <div className="p-3 rounded-xl space-y-3" style={{ border: '1px solid var(--border-2)' }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label style={fieldLabel}>Tanggal</label>
                        <input type="date" value={dDate} onChange={e => setDDate(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label style={fieldLabel}>Supplier</label>
                        <SearchSelect value={dSupplierId}
                          onChange={id => { setDSupplierId(id); const sp = suppliers.find(x => x.id === id); if (sp) setDSupplierName(sp.name); }}
                          options={supplierOptions} placeholder="– Pilih Supplier –" searchPlaceholder="Cari supplier…" />
                      </div>
                    </div>
                    <div>
                      <label style={fieldLabel}>Nama Toko / Supplier</label>
                      <input type="text" value={dSupplierName} maxLength={120}
                        onChange={e => { setDSupplierName(e.target.value); if (suppliers.find(x => x.id === dSupplierId)?.name !== e.target.value) setDSupplierId(''); }}
                        placeholder="Ketik manual untuk toko/warung lain" className="input" />
                    </div>
                    <div>
                      <label style={fieldLabel}>Catatan</label>
                      <input type="text" value={dNote} onChange={e => setDNote(e.target.value)} maxLength={200} placeholder="Catatan tambahan (opsional)" className="input" />
                    </div>
                    {(dDate !== detail.date || dSupplierId !== (detail.supplierId ?? '') || dSupplierName !== detail.supplierName || dNote !== detail.notes.join(' · ')) && (
                      <button onClick={saveInfo} disabled={savingInfo || !dDate} className="btn-primary text-xs" style={{ height: 34 }}>
                        {savingInfo ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Simpan Info
                      </button>
                    )}
                  </div>
                ) : detail.notes.length > 0 && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Catatan: {detail.notes.join(' · ')}</p>
                )}

                {/* Checklist item */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ ...fieldLabel, marginBottom: 0 }}>{detail.pending.length > 0 ? 'Item Belanja — centang yang sudah dibeli, sesuaikan qty & harga dengan nota' : 'Item Belanja — semua sudah dibeli'}</label>
                  {detail.items.map(i => i.status === 'done' ? (
                    <div key={i.id} className="px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 text-xs" style={{ border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                      <span className="flex items-center gap-2"><Check size={13} style={{ color: 'var(--success)' }} /> {i.materialName} · {formatQty(i.qty)} {i.unit}</span>
                      <span className="tabular">{formatRp(i.qty * (i.price ?? 0))}</span>
                    </div>
                  ) : (
                    // Desktop: satu baris (centang · nama · qty & harga · dompet · hapus). Mobile: baris 1 = centang, nama, hapus;
                    // baris 2 = qty & harga berdampingan; baris 3 = dompet penuh.
                    <div key={i.id} className="p-3 rounded-xl flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-2.5" style={{ border: '1px solid var(--border-2)' }}>
                      <button onClick={() => toggle(i)} aria-label={i.checked ? 'Batal centang' : 'Centang sudah dibeli'}
                        className="flex-shrink-0 w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center transition-colors order-1"
                        style={{ background: i.checked ? 'var(--accent)' : 'transparent', borderColor: i.checked ? 'var(--accent)' : 'var(--border)' }}>
                        {i.checked && <Check size={13} color="#fff" strokeWidth={3} />}
                      </button>
                      <div className="flex-1 min-w-0 order-2">
                        <p className="text-sm font-semibold break-words" style={{ color: 'var(--text-primary)', textDecoration: i.checked ? 'line-through' : 'none' }}>{i.materialName}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Satuan: {i.unit}</p>
                      </div>
                      <div className="order-3 md:order-5 flex-shrink-0">
                        <Tooltip label="Hapus dari daftar">
                          <button onClick={() => removeItem(i)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                        </Tooltip>
                      </div>
                      <div className="order-4 md:order-3 w-full md:w-auto flex items-center gap-2">
                        <div className="flex items-center gap-1.5 flex-1 md:flex-none">
                          <input type="number" min="0" value={i.qty} onChange={e => setLocal(i.id, { qty: parseFloat(e.target.value) || 0 })}
                            onBlur={() => { if (i.qty > 0) patch(i.id, { qty: i.qty }); else load(); }}
                            className="input text-right w-full md:w-[72px]" />
                          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{i.unit}</span>
                        </div>
                        <div className="flex-1 md:flex-none md:w-[112px]" onBlur={() => patch(i.id, { price: i.price })}>
                          <NumberInput value={i.price != null ? String(Math.round(i.price)) : ''} placeholder="Harga/satuan"
                            onChange={raw => setLocal(i.id, { price: raw ? parseFloat(raw) : null })} />
                        </div>
                      </div>
                      {i.checked && (
                        <div className="order-5 md:order-4 w-full md:w-[190px] md:flex-shrink-0">
                          <SearchSelect value={itemWallets[i.id] ?? ''} onChange={w => setItemWallets(prev => ({ ...prev, [i.id]: w }))}
                            options={[{ value: '', label: walletId ? 'Ikut dompet utama' : '– Pilih dompet –' }, ...walletOptions]}
                            placeholder="Dompet" searchPlaceholder="Cari dompet…" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Tambah item ke daftar ini */}
                {detail.pending.length > 0 && (
                <div className="p-3 rounded-xl space-y-3" style={{ border: '1px dashed var(--border)' }}>
                  {rowsEditor}
                  <button onClick={addToDetail} disabled={saving || validRows.length === 0} className="btn-ghost text-xs w-full justify-center py-2.5">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    {validRows.length > 1 ? `Tambah ${validRows.length} Item ke Daftar` : 'Tambah ke Daftar'}
                  </button>
                </div>
                )}

                {/* Pembayaran — muncul setelah ada item yang dicentang, jadi tidak perlu modal kedua */}
                {detail.checked.length > 0 && (
                  <div className="p-3 rounded-xl space-y-3" style={{ border: '1px solid var(--accent)', background: 'var(--surface)' }}>
                    <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Pembayaran — {detail.checked.length} item dicentang · {formatRp(checkedTotal)}</p>
                    {missingPrice.length > 0 && (
                      <p className="text-xs" style={{ color: 'var(--danger)' }}>Isi harga sebenarnya untuk: {missingPrice.map(i => i.materialName).join(', ')}.</p>
                    )}
                    {!detail.supplierName.trim() && (
                      <p className="text-xs" style={{ color: 'var(--danger)' }}>Daftar ini belum punya nama toko/supplier. Isi dulu di bagian info di atas, lalu Simpan Info.</p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label style={fieldLabel}>Tanggal Pembelian</label>
                        <input type="date" value={pDate} onChange={e => setPDate(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label style={fieldLabel}>Dompet Utama <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <SearchSelect value={walletId} onChange={setWalletId} options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                        {walletId && <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Saldo: {formatRp(walletBalances[walletId] ?? 0)} · dipakai item yang tidak dipilih dompetnya</p>}
                      </div>
                    </div>
                    {walletTotals.size > 0 && (
                      <div className="rounded-xl p-3 text-xs space-y-1.5" style={{ background: 'var(--accent-bg)' }}>
                        <p className="font-bold" style={{ color: 'var(--text-primary)' }}>Ringkasan per dompet — {walletTotals.size} pembelian akan dibuat</p>
                        {[...walletTotals.entries()].map(([w, total]) => (
                          <div key={w} className="flex justify-between gap-3">
                            <span style={{ color: 'var(--text-secondary)' }}>{walletNames[w] ?? 'Dompet'} <span style={{ color: 'var(--text-muted)' }}>(saldo {formatRp(walletBalances[w] ?? 0)})</span></span>
                            <span className="font-bold tabular" style={{ color: paymentStatus === 'lunas' && total > (walletBalances[w] ?? 0) ? 'var(--danger)' : 'var(--text-primary)' }}>{formatRp(total)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div>
                      <label style={fieldLabel}>Status Pembayaran</label>
                      <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                        {(['lunas', 'belum_lunas'] as const).map(st => (
                          <button key={st} type="button" onClick={() => setPaymentStatus(st)} className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                            style={paymentStatus === st ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                            {st === 'lunas' ? 'Lunas' : 'Belum Lunas'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={fieldLabel}>Catatan Pembelian</label>
                      <input type="text" value={pNote} onChange={e => setPNote(e.target.value)} className="input" placeholder="Opsional (default: Dari Daftar Belanja)" />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Daftar</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(detail.total)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setDetailKey(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>
              {detail.pending.length > 0 && (
                <button onClick={submitProcess} disabled={processing || !canProcess} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                  {processing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {processing ? 'Memproses…' : detail.checked.length > 0 ? `Simpan Pembelian (${detail.checked.length})` : 'Centang item untuk diproses'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Buat daftar belanja baru */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => !saving && setShowCreate(false)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingCart size={17} /></div>
                <div>
                  <p className="modal-title">Buat Daftar Belanja</p>
                  <p className="modal-subtitle">Belum mengubah stok — baru jadi pembelian setelah dicentang &amp; diproses</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowCreate(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Tanggal <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Supplier</label>
                    <SearchSelect value={fSupplierId}
                      onChange={id => { setFSupplierId(id); const sp = suppliers.find(x => x.id === id); if (sp) setFSupplierName(sp.name); }}
                      options={supplierOptions} placeholder="– Pilih Supplier –" searchPlaceholder="Cari supplier…" />
                  </div>
                </div>
                <div>
                  <label style={fieldLabel}>Nama Toko / Supplier</label>
                  <input type="text" value={fSupplierName} maxLength={120}
                    onChange={e => { setFSupplierName(e.target.value); if (suppliers.find(x => x.id === fSupplierId)?.name !== e.target.value) setFSupplierId(''); }}
                    placeholder="Terisi dari supplier yang dipilih; ketik manual untuk toko/warung lain" className="input" />
                </div>

                {rowsEditor}

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={fNote} onChange={e => setFNote(e.target.value)} maxLength={200} placeholder="Catatan tambahan (opsional)" className="input" />
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{validRows.length} item</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Perkiraan Total</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(formTotal)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreate(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={saveForm} disabled={saving || !canSave} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : validRows.length > 1 ? `Simpan (${validRows.length} item)` : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
