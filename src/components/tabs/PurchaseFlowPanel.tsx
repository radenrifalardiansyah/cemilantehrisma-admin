'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, PackageCheck, Plus, Pencil, Trash2, X, Check, Loader2, Ban, MessageCircle, Search, FileText, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useViewMode } from '@/lib/useViewMode';
import { exportSheet, downloadPoTemplate, parsePoExcel } from '@/components/tabs/purchase-flow-io';
import PurchaseDocPDF from '@/lib/pdf/PurchaseDocPDF';
import { poToDocData, grToDocData } from '@/lib/pdf/purchase-doc-data';
import type { StoreHeader } from '@/lib/pdf/ShipmentNotePDF';
import type { PoStatus, GrStatus, PoItem, GrItem } from '@/lib/purchase-orders-pg';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { RecordHistoryButton, RecordHistoryPanel } from '@/components/RecordHistory';

// Purchase Order (PO) & Penerimaan Barang (GR/DO) Bahan Baku. PO tidak mengubah stok/keuangan;
// pembelian baru masuk ke tab Pembelian saat GR di-approve (lihat api/goods-receipts/[id]/approve).
// Daftar dimuat hanya saat sub-tab ini dibuka & setelah aksi — tanpa polling — dan data bahan/
// supplier/dompet/header toko dioper dari MaterialsTab supaya tidak ada fetch ganda.

const HEADER_BTN_H = 34;

export interface FlowMaterial { id: string; name: string; unit: string; stockQty: number; avgCost: number }
export interface FlowSupplier { id: string; name: string; phone?: string }

interface Po {
  id: string; poNumber: string; supplierId: string | null; supplierName: string; supplierPhone: string;
  items: PoItem[]; total: number; date: string; expectedDate: string | null; note: string;
  status: PoStatus; cancelNote: string | null; received: Record<string, number>;
}
interface Gr {
  id: string; grNumber: string; doNumber: string; supplierDoNumber: string; poId: string;
  poNumber: string | null; supplierName: string | null; items: GrItem[]; total: number;
  receivedDate: string; note: string; status: GrStatus; walletId: string | null; paymentStatus: string | null;
  purchaseId: string | null; cancelNote: string | null;
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const formatQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDateDisplay = (iso?: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
const normalizePhone = (raw: string) => {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : '62' + d;
};
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };

const PO_BADGE: Record<PoStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'badge-gray' },
  terkirim: { label: 'Terkirim', cls: 'badge-blue' },
  diterima_sebagian: { label: 'Diterima Sebagian', cls: 'badge-amber' },
  diterima: { label: 'Diterima Penuh', cls: 'badge-green' },
  batal: { label: 'Dibatalkan', cls: 'badge-red' },
};
const GR_BADGE: Record<GrStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft — menunggu approve', cls: 'badge-amber' },
  approved: { label: 'Approved', cls: 'badge-green' },
  dibatalkan: { label: 'Dibatalkan', cls: 'badge-gray' },
};

interface PoRowInput { materialId: string; qty: string; price: string }
interface GrRowInput { materialId: string; name: string; unit: string; orderedQty: number; qty: string; price: string }

interface Props {
  creds: string;
  view: 'po' | 'gr';
  onSwitchView: (v: 'po' | 'gr') => void;
  materials: FlowMaterial[];
  suppliers: FlowSupplier[];
  walletOptions: { value: string; label: string; sublabel?: string }[];
  walletBalances: Record<string, number>;
  storeHeader: StoreHeader;
  canApprove: boolean;
  /** Dipanggil setelah aksi yang mengubah stok/keuangan (approve/batal GR) supaya induk memuat ulang. */
  onStockChanged: () => void;
}

export default function PurchaseFlowPanel({
  creds, view, onSwitchView, materials, suppliers, walletOptions, walletBalances, storeHeader, canApprove, onStockChanged,
}: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };

  const [pos, setPos] = useState<Po[]>([]);
  const [grs, setGrs] = useState<Gr[]>([]);
  const [loaded, setLoaded] = useState({ po: false, gr: false });
  const [search, setSearch] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);

  const loadPos = useCallback(async () => {
    const r = await fetch('/api/purchase-orders', { headers: { 'x-admin-auth': creds } });
    if (r.ok) setPos((await r.json() as { purchaseOrders: Po[] }).purchaseOrders);
  }, [creds]);
  const loadGrs = useCallback(async () => {
    const r = await fetch('/api/goods-receipts', { headers: { 'x-admin-auth': creds } });
    if (r.ok) setGrs((await r.json() as { goodsReceipts: Gr[] }).goodsReceipts);
  }, [creds]);

  // Hanya daftar yang sedang tampil yang dimuat; daftar lain dimuat saat berpindah sub-tab.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- memuat data saat sub-tab dibuka (pola sama dengan tab lain)
    (view === 'po' ? loadPos() : loadGrs()).finally(() => { if (!cancelled) setLoaded(l => ({ ...l, [view]: true })); });
    return () => { cancelled = true; };
  }, [view, loadPos, loadGrs]);

  // ── PDF (dirender di browser — tanpa beban server) ─────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null);
  const downloadPdf = async (key: string, doc: React.ReactElement, filename: string) => {
    setBusyId(key);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(doc as any).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error('Gagal membuat PDF.'); }
    finally { setBusyId(null); }
  };
  const poPdf = (p: Po) => downloadPdf(`po-${p.id}`, <PurchaseDocPDF data={poToDocData(p)} store={storeHeader} />, p.poNumber);
  const grPdf = (g: Gr, kind: 'gr' | 'do') =>
    downloadPdf(`${kind}-${g.id}`, <PurchaseDocPDF data={grToDocData(g, kind)} store={storeHeader} />, kind === 'do' ? g.doNumber : g.grNumber);

  // ── Kirim WA ke supplier (tombol manual — pengguna yang menekan Kirim di WhatsApp) ──
  const sendPoWhatsApp = async (p: Po) => {
    if (!p.supplierPhone.trim()) { toast.error('Nomor WhatsApp supplier belum diisi. Edit PO atau isi di data Supplier.'); return; }
    // Jendela dibuka SEKARANG (sebelum await) supaya tidak diblokir popup-blocker, lalu diarahkan.
    const win = window.open('', '_blank');
    setBusyId(`wa-${p.id}`);
    try {
      const r = await fetch(`/api/purchase-orders/${p.id}/send`, { method: 'POST', headers });
      const d = await r.json() as { error?: string; purchaseOrder?: { token: string } };
      if (!r.ok || !d.purchaseOrder) { win?.close(); toast.error(d.error ?? 'Gagal menyiapkan PO.'); return; }
      const SEP = '─────────────────────';
      const itemLines = p.items
        .map((it, i) => `${i + 1}. ${it.materialName}\n   ${formatQty(it.qty)} ${it.unit} x ${formatRp(it.price)} = *${formatRp(it.subtotal)}*`)
        .join('\n');
      const pdfUrl = `${window.location.origin}/api/purchase-orders/${p.id}/pdf?t=${d.purchaseOrder.token}`;
      const message = `*PURCHASE ORDER ${storeHeader.name.toUpperCase()}*
${SEP}
No. PO  : *${p.poNumber}*
Tanggal : ${formatDateDisplay(p.date)}${p.expectedDate ? `\nEstimasi tiba : ${formatDateDisplay(p.expectedDate)}` : ''}
Kepada  : *${p.supplierName}*
${SEP}
${itemLines}
${SEP}
*Total : ${formatRp(p.total)}*${p.note ? `\nCatatan : ${p.note}` : ''}
${SEP}

Dokumen PO (PDF):
${pdfUrl}`.trim();
      const waUrl = `https://wa.me/${normalizePhone(p.supplierPhone)}?text=${encodeURIComponent(message)}`;
      if (win) win.location.href = waUrl; else window.location.href = waUrl;
      await loadPos();
    } finally { setBusyId(null); }
  };

  // ── Form PO ────────────────────────────────────────────────────────────────
  const [showPoForm, setShowPoForm] = useState(false);
  const [editingPo, setEditingPo] = useState<Po | null>(null);
  const [fSupplierId, setFSupplierId] = useState('');
  const [fSupplierName, setFSupplierName] = useState('');
  const [fSupplierPhone, setFSupplierPhone] = useState('');
  const [fDate, setFDate] = useState(todayISO());
  const [fExpected, setFExpected] = useState('');
  const [fNote, setFNote] = useState('');
  const [fRows, setFRows] = useState<PoRowInput[]>([{ materialId: '', qty: '', price: '' }]);
  const [savingPo, setSavingPo] = useState(false);

  const openCreatePo = () => {
    setEditingPo(null); setFSupplierId(''); setFSupplierName(''); setFSupplierPhone(''); setFDate(todayISO());
    setFExpected(''); setFNote(''); setFRows([{ materialId: '', qty: '', price: '' }]); setShowPoForm(true);
  };
  const openEditPo = (p: Po) => {
    setEditingPo(p); setFSupplierId(p.supplierId ?? ''); setFSupplierName(p.supplierName); setFSupplierPhone(p.supplierPhone);
    setFDate(p.date); setFExpected(p.expectedDate ?? ''); setFNote(p.note);
    setFRows(p.items.map(it => ({ materialId: it.materialId, qty: String(it.qty), price: String(Math.round(it.price)) })));
    setShowPoForm(true);
  };
  const updateRow = (i: number, patch: Partial<PoRowInput>) => setFRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const poTotal = fRows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0), 0);
  const canSavePo = fSupplierName.trim() !== '' && !!fDate && fRows.some(r => r.materialId && (parseFloat(r.qty) || 0) > 0);

  const savePo = async () => {
    if (!canSavePo) return;
    setSavingPo(true);
    try {
      const items = fRows.filter(r => r.materialId && (parseFloat(r.qty) || 0) > 0).map(r => {
        const m = materials.find(mm => mm.id === r.materialId)!;
        return { materialId: m.id, materialName: m.name, unit: m.unit, qty: parseFloat(r.qty) || 0, price: parseFloat(r.price) || 0 };
      });
      const payload = {
        supplierId: fSupplierId || null, supplierName: fSupplierName.trim(), supplierPhone: fSupplierPhone.trim(),
        date: fDate, expectedDate: fExpected || null, note: fNote, items,
      };
      const res = editingPo
        ? await fetch(`/api/purchase-orders/${editingPo.id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) })
        : await fetch('/api/purchase-orders', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) });
      const d = await res.json() as { error?: string; poNumber?: string };
      if (!res.ok) { toast.error(d.error ?? 'Gagal menyimpan PO.'); return; }
      toast.success(editingPo ? 'PO diperbarui.' : `PO ${d.poNumber} dibuat.`);
      setShowPoForm(false);
      await loadPos();
    } finally { setSavingPo(false); }
  };

  const deletePo = async (p: Po) => {
    if (!await confirm({ message: `Hapus PO ${p.poNumber}? PO draft yang belum punya GR dihapus permanen.`, danger: true })) return;
    setBusyId(`del-${p.id}`);
    const r = await fetch(`/api/purchase-orders/${p.id}`, { method: 'DELETE', headers });
    const d = await r.json().catch(() => ({})) as { error?: string };
    if (r.ok) { toast.success('PO dihapus.'); await loadPos(); } else toast.error(d.error ?? 'Gagal menghapus PO.');
    setBusyId(null);
  };

  // ── Buat GR (satu klik, item terisi dari sisa PO) ──────────────────────────
  const createGr = async (p: Po) => {
    setBusyId(`gr-${p.id}`);
    try {
      const r = await fetch('/api/goods-receipts', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ poId: p.id }) });
      const d = await r.json() as { error?: string; id?: string; grNumber?: string; doNumber?: string };
      if (!r.ok || !d.id) { toast.error(d.error ?? 'Gagal membuat GR.'); return; }
      toast.success(`${d.grNumber} & ${d.doNumber} dibuat. Cek qty yang datang lalu approve.`);
      onSwitchView('gr');
      const gr = await fetch(`/api/goods-receipts/${d.id}`, { headers });
      if (gr.ok) openEditGr((await gr.json() as { goodsReceipt: Gr }).goodsReceipt);
    } finally { setBusyId(null); }
  };

  // ── Form GR ────────────────────────────────────────────────────────────────
  const [editingGr, setEditingGr] = useState<Gr | null>(null);
  const [gRows, setGRows] = useState<GrRowInput[]>([]);
  const [gDate, setGDate] = useState(todayISO());
  const [gSupplierDo, setGSupplierDo] = useState('');
  const [gNote, setGNote] = useState('');
  const [gWallet, setGWallet] = useState('');
  const [gPayment, setGPayment] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [savingGr, setSavingGr] = useState(false);

  function openEditGr(g: Gr) {
    setEditingGr(g);
    setGRows(g.items.map(it => ({ materialId: it.materialId, name: it.materialName, unit: it.unit, orderedQty: it.orderedQty, qty: String(it.qty), price: String(Math.round(it.price)) })));
    setGDate(g.receivedDate); setGSupplierDo(g.supplierDoNumber); setGNote(g.note);
    setGWallet(g.walletId ?? ''); setGPayment(g.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas');
  }
  const grTotal = gRows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0), 0);

  const saveGr = async (approve: boolean) => {
    if (!editingGr) return;
    if (approve && !gWallet) { toast.error('Pilih dompet sumber dulu.'); return; }
    setSavingGr(true);
    try {
      const body = {
        items: gRows.map(r => ({ materialId: r.materialId, qty: parseFloat(r.qty) || 0, price: parseFloat(r.price) || 0 })),
        receivedDate: gDate, supplierDoNumber: gSupplierDo, note: gNote, walletId: gWallet || null, paymentStatus: gPayment,
      };
      const res = await fetch(`/api/goods-receipts/${editingGr.id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { toast.error(d.error ?? 'Gagal menyimpan GR.'); return; }
      if (approve) {
        const ar = await fetch(`/api/goods-receipts/${editingGr.id}/approve`, {
          method: 'POST', headers: jsonHeaders, body: JSON.stringify({ walletId: gWallet, paymentStatus: gPayment }),
        });
        const ad = await ar.json().catch(() => ({})) as { error?: string };
        if (!ar.ok) { toast.error(ad.error ?? 'Gagal meng-approve GR.'); await loadGrs(); return; }
        toast.success('GR di-approve — pembelian masuk ke tab Pembelian & stok bertambah.');
        onStockChanged();
      } else toast.success('GR tersimpan.');
      setEditingGr(null);
      await loadGrs();
    } finally { setSavingGr(false); }
  };

  const deleteGr = async (g: Gr) => {
    if (!await confirm({ message: `Hapus GR draft ${g.grNumber}?`, danger: true })) return;
    setBusyId(`del-${g.id}`);
    const r = await fetch(`/api/goods-receipts/${g.id}`, { method: 'DELETE', headers });
    const d = await r.json().catch(() => ({})) as { error?: string };
    if (r.ok) { toast.success('GR dihapus.'); await loadGrs(); } else toast.error(d.error ?? 'Gagal menghapus GR.');
    setBusyId(null);
  };

  // ── Dialog batal (PO / GR) ─────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<{ kind: 'po' | 'gr'; id: string; label: string; needReason: boolean; warn: string } | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const askCancelPo = (p: Po) => {
    setCancelNote('');
    setCancelTarget({ kind: 'po', id: p.id, label: p.poNumber, needReason: false, warn: 'PO ditandai dibatalkan dan tidak bisa dibuatkan GR lagi. GR draft yang menggantung ikut dibatalkan.' });
  };
  const askCancelGr = (g: Gr) => {
    setCancelNote('');
    const approved = g.status === 'approved';
    setCancelTarget({
      kind: 'gr', id: g.id, label: g.grNumber, needReason: approved,
      warn: approved
        ? 'Pembelian hasil GR ini dibatalkan: stok & harga rata-rata dikembalikan dan pengeluaran dihapus. Kalau bahan sudah dipakai produksi / dibeli lagi, stok bahan itu dibiarkan dan perlu dikoreksi manual di menu Stok.'
        : 'GR draft dibatalkan. Stok dan keuangan tidak berubah.',
    });
  };
  const doCancel = async () => {
    if (!cancelTarget) return;
    if (cancelTarget.needReason && !cancelNote.trim()) { toast.error('Alasan pembatalan wajib diisi.'); return; }
    setCancelling(true);
    try {
      const url = cancelTarget.kind === 'po' ? `/api/purchase-orders/${cancelTarget.id}/cancel` : `/api/goods-receipts/${cancelTarget.id}/cancel`;
      const r = await fetch(url, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ note: cancelNote.trim() }) });
      const d = await r.json().catch(() => ({})) as { error?: string; reversed?: boolean | null; skippedMaterials?: string[] };
      if (!r.ok) { toast.error(d.error ?? 'Gagal membatalkan.'); return; }
      if (d.reversed === false) {
        toast.success(`GR dibatalkan, TAPI stok tidak diubah karena sudah dipakai/dibeli lagi: ${(d.skippedMaterials ?? []).join(', ')}. Betulkan lewat "Koreksi" di menu Stok.`);
      } else toast.success(`${cancelTarget.label} dibatalkan.`);
      setCancelTarget(null);
      await Promise.all([loadPos(), loadGrs()]);
      if (cancelTarget.kind === 'gr') onStockChanged();
    } finally { setCancelling(false); }
  };

  // ── Daftar: cari, halaman, tampilan Tabel/Kartu ────────────────────────────
  const q = search.trim().toLowerCase();
  const filteredPos = pos.filter(p => !q || p.poNumber.toLowerCase().includes(q) || p.supplierName.toLowerCase().includes(q));
  const filteredGrs = grs.filter(g => !q || g.grNumber.toLowerCase().includes(q) || g.doNumber.toLowerCase().includes(q)
    || (g.poNumber ?? '').toLowerCase().includes(q) || (g.supplierName ?? '').toLowerCase().includes(q) || g.supplierDoNumber.toLowerCase().includes(q));
  const [poView, setPoView] = useViewMode('purchase-orders');
  const [grView, setGrView] = useViewMode('goods-receipts');
  const mode = view === 'po' ? poView : grView;
  const setMode = view === 'po' ? setPoView : setGrView;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const total = view === 'po' ? filteredPos.length : filteredGrs.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const sliceFrom = (safePage - 1) * (Number.isFinite(pageSize) ? pageSize : 0);
  const sliceTo = Number.isFinite(pageSize) ? safePage * pageSize : undefined;
  const pagedPos = filteredPos.slice(sliceFrom, sliceTo);
  const pagedGrs = filteredGrs.slice(sliceFrom, sliceTo);

  // ── Excel / PDF ────────────────────────────────────────────────────────────
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const itemsText = (items: { materialName: string; qty: number; unit: string }[]) => items.map(it => `${it.materialName} (${formatQty(it.qty)} ${it.unit})`).join(', ');
  const rowsForExport = (): (string | number)[][] => view === 'po'
    ? filteredPos.map((p, i) => [i + 1, p.poNumber, formatDateDisplay(p.date), p.supplierName, itemsText(p.items), p.total, PO_BADGE[p.status].label, p.expectedDate ? formatDateDisplay(p.expectedDate) : '-', p.note || '-'])
    : filteredGrs.map((g, i) => [i + 1, g.grNumber, g.doNumber, g.supplierDoNumber || '-', g.poNumber ?? '-', g.supplierName ?? '-', formatDateDisplay(g.receivedDate), itemsText(g.items), g.total, GR_BADGE[g.status].label]);

  const exportExcel = async () => {
    if (total === 0) { toast.error('Tidak ada data untuk diexport.'); return; }
    setExportingXlsx(true);
    try {
      const day = new Date().toLocaleDateString('en-CA');
      await exportSheet(view === 'po'
        ? { sheet: 'Purchase Order', title: 'PURCHASE ORDER BAHAN BAKU — CEMILAN TEH RISMA', filename: `purchase-order-cemilantehrisma-${day}.xlsx`,
            columns: [{ header: 'No', width: 6 }, { header: 'No. PO', width: 18 }, { header: 'Tanggal', width: 14 }, { header: 'Supplier', width: 24 }, { header: 'Bahan Baku', width: 44 }, { header: 'Total', width: 16 }, { header: 'Status', width: 18 }, { header: 'Estimasi Tiba', width: 14 }, { header: 'Catatan', width: 28 }],
            rows: rowsForExport() }
        : { sheet: 'Penerimaan Barang', title: 'PENERIMAAN BARANG (GR) BAHAN BAKU — CEMILAN TEH RISMA', filename: `penerimaan-barang-cemilantehrisma-${day}.xlsx`,
            columns: [{ header: 'No', width: 6 }, { header: 'No. GR', width: 18 }, { header: 'No. DO', width: 18 }, { header: 'No. DO Supplier', width: 18 }, { header: 'No. PO', width: 18 }, { header: 'Supplier', width: 24 }, { header: 'Tgl Terima', width: 14 }, { header: 'Bahan Baku', width: 44 }, { header: 'Total', width: 16 }, { header: 'Status', width: 22 }],
            rows: rowsForExport() });
      toast.success(`Berhasil export ${total} data ke Excel.`);
    } catch { toast.error('Gagal membuat file Excel.'); }
    finally { setExportingXlsx(false); }
  };

  const exportPdf = async () => {
    if (total === 0) { toast.error('Tidak ada data untuk diexport.'); return; }
    setExportingPdf(true);
    try {
      const generatedAt = new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const rows = rowsForExport().map(r => r.map((c, i) => (typeof c === 'number' && ((view === 'po' && i === 5) || (view === 'gr' && i === 8)) ? formatRp(c) : c)));
      const data = view === 'po'
        ? { title: 'PURCHASE ORDER BAHAN BAKU', label: 'sesuai filter', generatedAt, rows,
            columns: [{ header: 'No', width: '4%', align: 'center' as const }, { header: 'No. PO', width: '12%' }, { header: 'Tanggal', width: '9%' }, { header: 'Supplier', width: '13%' }, { header: 'Bahan Baku', width: '25%' }, { header: 'Total', width: '10%', align: 'right' as const, bold: true }, { header: 'Status', width: '10%', align: 'center' as const }, { header: 'Est. Tiba', width: '9%' }, { header: 'Catatan', width: '8%' }] }
        : { title: 'PENERIMAAN BARANG (GR) BAHAN BAKU', label: 'sesuai filter', generatedAt, rows,
            columns: [{ header: 'No', width: '4%', align: 'center' as const }, { header: 'No. GR', width: '11%' }, { header: 'No. DO', width: '11%' }, { header: 'DO Supplier', width: '9%' }, { header: 'No. PO', width: '11%' }, { header: 'Supplier', width: '10%' }, { header: 'Tgl Terima', width: '8%' }, { header: 'Bahan Baku', width: '15%' }, { header: 'Total', width: '10%', align: 'right' as const, bold: true }, { header: 'Status', width: '11%', align: 'center' as const }] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(<GenericTablePDF store={storeHeader} data={data} /> as any).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${view === 'po' ? 'purchase-order' : 'penerimaan-barang'}-cemilantehrisma-${new Date().toLocaleDateString('en-CA')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Berhasil export ${total} data ke PDF.`);
    } catch { toast.error('Gagal membuat file PDF.'); }
    finally { setExportingPdf(false); }
  };

  const templateDownload = async () => {
    try { await downloadPoTemplate(materials.map(m => m.name), suppliers[0]?.name, todayISO()); }
    catch { toast.error('Gagal membuat template.'); }
  };

  const importPos = async (file: File) => {
    setImporting(true);
    try {
      const parsed = await parsePoExcel(file, materials, todayISO());
      if ('error' in parsed) { toast.error(parsed.error); return; }
      if (parsed.pos.length === 0) { toast.error('Tidak ada data PO valid. Pastikan Supplier & Bahan Baku sesuai daftar, dan Qty terisi.'); return; }
      const r = await fetch('/api/purchase-orders/bulk-import', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ purchaseOrders: parsed.pos }) });
      const d = await r.json().catch(() => ({})) as { error?: string; created?: number; skippedInvalid?: number };
      if (!r.ok) { toast.error(d.error ?? 'Gagal mengimpor PO.'); return; }
      const skipped = (d.skippedInvalid ?? 0) + parsed.skipped;
      toast.success(`${d.created} PO draft berhasil diimpor.${skipped > 0 ? ` (${skipped} baris/PO tidak valid dilewati)` : ''}`);
      await loadPos();
    } catch { toast.error('Gagal membaca file Excel. Pastikan format sesuai template.'); }
    finally { setImporting(false); }
  };

  const iconBtn = 'w-7 h-7 rounded-lg flex items-center justify-center';
  const toolBtn = { height: HEADER_BTN_H, width: HEADER_BTN_H };
  const materialOptions = materials.map(m => ({ value: m.id, label: m.name, sublabel: `Stok ${formatQty(m.stockQty)} ${m.unit}` }));
  const supplierOptions = [{ value: '', label: '– Supplier lain / tidak tercatat –' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))];
  const Spin = () => <Loader2 size={12} className="animate-spin" />;

  // Tombol aksi per baris — dipakai bersama oleh tampilan Tabel dan Kartu.
  const poActions = (p: Po) => {
    const canGr = p.status === 'draft' || p.status === 'terkirim' || p.status === 'diterima_sebagian';
    return (
      <>
        {canGr && (
          <button onClick={() => createGr(p)} disabled={busyId === `gr-${p.id}`} className="btn-ghost px-2.5 py-1 text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
            {busyId === `gr-${p.id}` ? <Spin /> : <PackageCheck size={12} />} Buat GR
          </button>
        )}
        {p.status !== 'batal' && (
          <Tooltip label="Download PDF PO">
            <button onClick={() => poPdf(p)} disabled={busyId === `po-${p.id}`} className={iconBtn} style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
              {busyId === `po-${p.id}` ? <Spin /> : <PdfIcon size={12} />}
            </button>
          </Tooltip>
        )}
        {p.status !== 'batal' && (
          <Tooltip label="Kirim PO ke supplier via WhatsApp">
            <button onClick={() => sendPoWhatsApp(p)} disabled={busyId === `wa-${p.id}`} className={iconBtn} style={{ background: 'var(--surface-2)', color: 'var(--success)' }}>
              {busyId === `wa-${p.id}` ? <Spin /> : <MessageCircle size={12} />}
            </button>
          </Tooltip>
        )}
        {p.status === 'draft' && (
          <Tooltip label="Edit PO">
            <button onClick={() => openEditPo(p)} className={iconBtn} style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}><Pencil size={12} /></button>
          </Tooltip>
        )}
        {p.status === 'draft' && (
          <Tooltip label="Hapus PO">
            <button onClick={() => deletePo(p)} disabled={busyId === `del-${p.id}`} className={iconBtn} style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {busyId === `del-${p.id}` ? <Spin /> : <Trash2 size={12} />}
            </button>
          </Tooltip>
        )}
        {p.status !== 'batal' && (
          <Tooltip label="Batalkan PO">
            <button onClick={() => askCancelPo(p)} className={iconBtn} style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}><Ban size={12} /></button>
          </Tooltip>
        )}
        <RecordHistoryButton open={historyId === p.id} onToggle={() => setHistoryId(c => c === p.id ? null : p.id)} />
      </>
    );
  };
  const grActions = (g: Gr) => (
    <>
      {g.status === 'draft' && (
        <button onClick={() => openEditGr(g)} className="btn-ghost px-2.5 py-1 text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
          <Pencil size={12} /> {canApprove ? 'Periksa & Approve' : 'Edit'}
        </button>
      )}
      <Tooltip label="Download PDF GR">
        <button onClick={() => grPdf(g, 'gr')} disabled={busyId === `gr-${g.id}`} className={iconBtn} style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
          {busyId === `gr-${g.id}` ? <Spin /> : <PdfIcon size={12} />}
        </button>
      </Tooltip>
      <Tooltip label="Download PDF DO (surat penerimaan)">
        <button onClick={() => grPdf(g, 'do')} disabled={busyId === `do-${g.id}`} className={iconBtn} style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
          {busyId === `do-${g.id}` ? <Spin /> : <FileText size={12} />}
        </button>
      </Tooltip>
      {g.status === 'draft' && (
        <Tooltip label="Hapus GR draft">
          <button onClick={() => deleteGr(g)} disabled={busyId === `del-${g.id}`} className={iconBtn} style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {busyId === `del-${g.id}` ? <Spin /> : <Trash2 size={12} />}
          </button>
        </Tooltip>
      )}
      {(g.status === 'draft' || (g.status === 'approved' && canApprove)) && (
        <Tooltip label={g.status === 'approved' ? 'Batalkan GR yang sudah di-approve' : 'Batalkan GR'}>
          <button onClick={() => askCancelGr(g)} className={iconBtn} style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}><Ban size={12} /></button>
        </Tooltip>
      )}
      <RecordHistoryButton open={historyId === g.id} onToggle={() => setHistoryId(c => c === g.id ? null : g.id)} />
    </>
  );
  const poItemsText = (p: Po) => p.items.map(it => {
    const got = p.received[it.materialId] ?? 0;
    return `${it.materialName} (${got > 0 ? `${formatQty(got)}/` : ''}${formatQty(it.qty)} ${it.unit})`;
  }).join(', ');
  const grItemsText = (g: Gr) => g.items.map(it => `${it.materialName} (${formatQty(it.qty)}/${formatQty(it.orderedQty)} ${it.unit})`).join(', ');

  if (!loaded[view]) return <PageLoader />;

  const isEmpty = view === 'po' ? pos.length === 0 : grs.length === 0;

  return (
    <div className="p-4 lg:p-6 animate-fade-up space-y-4">
      {isEmpty ? (
        view === 'po'
          ? <EmptyAddCard label="Buat Purchase Order" onClick={openCreatePo} />
          : <EmptyAddCard label="Buat GR dari Purchase Order" hint="GR dibuat dari tombol “Buat GR” di PO" onClick={() => onSwitchView('po')} />
      ) : (
      <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {view === 'po' ? <><ClipboardList size={11} /> Purchase Order ({pos.length})</> : <><PackageCheck size={11} /> Penerimaan Barang ({grs.length})</>}
        </p>
        <div className="flex flex-row items-center gap-2 sm:gap-3 sm:flex-1">
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input text-sm w-full"
              style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder={view === 'po' ? 'Cari no. PO atau supplier…' : 'Cari no. GR, DO, PO, atau supplier…'} />
          </div>
          <div className="flex items-center gap-2 sm:justify-end flex-shrink-0">
            {view === 'po' && (
              <>
                <Tooltip label="Unduh Template">
                  <button onClick={templateDownload} aria-label="Unduh Template" className="btn-ghost p-0 flex items-center justify-center" style={toolBtn}><ExcelIcon size={14} /></button>
                </Tooltip>
                <Tooltip label={importing ? 'Mengimpor…' : 'Upload Excel'}>
                  <button onClick={() => importRef.current?.click()} disabled={importing} aria-label="Upload Excel" className="btn-ghost p-0 flex items-center justify-center" style={toolBtn}>
                    {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  </button>
                </Tooltip>
                <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) importPos(f); e.target.value = ''; }} />
              </>
            )}
            <Tooltip label="Export Excel">
              <button onClick={exportExcel} disabled={exportingXlsx} aria-label="Export Excel" className="btn-ghost p-0 flex items-center justify-center" style={toolBtn}>
                {exportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
              </button>
            </Tooltip>
            <Tooltip label="Export PDF">
              <button onClick={exportPdf} disabled={exportingPdf} aria-label="Export PDF" className="btn-ghost p-0 flex items-center justify-center" style={toolBtn}>
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
              </button>
            </Tooltip>
            <ViewToggle mode={mode} onChange={setMode} height={HEADER_BTN_H} />
            {view === 'po'
              ? (
                <button onClick={openCreatePo} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Buat PO</span>
                </button>
              ) : (
                <button onClick={() => onSwitchView('po')} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
                  <Plus size={13} /> <span className="hidden sm:inline">Buat GR dari PO</span>
                </button>
              )}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="card py-10 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{view === 'po' ? 'Tidak ada PO yang cocok.' : 'Tidak ada GR yang cocok.'}</p>
        </div>
      ) : mode === 'table' ? (
        <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
          {view === 'po' ? pagedPos.map((p, idx) => (
            <div key={p.id}>
              <div className="px-4 py-3" style={{ opacity: p.status === 'batal' ? 0.55 : 1 }}>
                <div className="flex items-start gap-3">
                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-0.5" style={{ color: 'var(--text-muted)' }}>{sliceFrom + idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{p.poNumber}</p>
                          <span className={`badge ${PO_BADGE[p.status].cls}`}>{PO_BADGE[p.status].label}</span>
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {p.supplierName} · {formatDateDisplay(p.date)}{p.expectedDate ? ` · tiba ${formatDateDisplay(p.expectedDate)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <span className="text-sm font-bold tabular mr-1" style={{ color: 'var(--success)' }}>{formatRp(p.total)}</span>
                        {poActions(p)}
                      </div>
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>{poItemsText(p)}</p>
                    {p.status === 'batal' && p.cancelNote && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>Alasan batal: {p.cancelNote}</p>}
                  </div>
                </div>
              </div>
              {historyId === p.id && <RecordHistoryPanel creds={creds} entity="purchase-orders" entityId={p.id} />}
            </div>
          )) : pagedGrs.map((g, idx) => (
            <div key={g.id}>
              <div className="px-4 py-3" style={{ opacity: g.status === 'dibatalkan' ? 0.55 : 1 }}>
                <div className="flex items-start gap-3">
                  <span className="text-[11px] font-bold tabular-nums flex-shrink-0 w-5 text-center pt-0.5" style={{ color: 'var(--text-muted)' }}>{sliceFrom + idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{g.grNumber}</p>
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>/ {g.doNumber}</span>
                          <span className={`badge ${GR_BADGE[g.status].cls}`}>{GR_BADGE[g.status].label}</span>
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {g.supplierName} · dari {g.poNumber} · {formatDateDisplay(g.receivedDate)}{g.supplierDoNumber ? ` · DO supplier ${g.supplierDoNumber}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <span className="text-sm font-bold tabular mr-1" style={{ color: 'var(--success)' }}>{formatRp(g.total)}</span>
                        {grActions(g)}
                      </div>
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>{grItemsText(g)}</p>
                    {g.status === 'dibatalkan' && g.cancelNote && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>Alasan batal: {g.cancelNote}</p>}
                  </div>
                </div>
              </div>
              {historyId === g.id && <RecordHistoryPanel creds={creds} entity="goods-receipts" entityId={g.id} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {view === 'po' ? pagedPos.map(p => (
            <div key={p.id}>
              <div className="card overflow-hidden" style={{ opacity: p.status === 'batal' ? 0.55 : 1 }}>
                <div className="pt-5 pb-3 px-4 text-center">
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{p.poNumber}</p>
                  <div className="mt-1"><span className={`badge ${PO_BADGE[p.status].cls}`}>{PO_BADGE[p.status].label}</span></div>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>{p.supplierName}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(p.date)}{p.expectedDate ? ` · tiba ${formatDateDisplay(p.expectedDate)}` : ''}</p>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>{poItemsText(p)}</p>
                  <p className="text-base font-extrabold tabular mt-2" style={{ color: 'var(--success)' }}>{formatRp(p.total)}</p>
                </div>
                <div className="flex items-center justify-center gap-1 flex-wrap px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>{poActions(p)}</div>
                {p.status === 'batal' && p.cancelNote && <p className="text-xs text-center px-4 pb-3 italic" style={{ color: 'var(--text-muted)' }}>Alasan batal: {p.cancelNote}</p>}
              </div>
              {historyId === p.id && <RecordHistoryPanel creds={creds} entity="purchase-orders" entityId={p.id} />}
            </div>
          )) : pagedGrs.map(g => (
            <div key={g.id}>
              <div className="card overflow-hidden" style={{ opacity: g.status === 'dibatalkan' ? 0.55 : 1 }}>
                <div className="pt-5 pb-3 px-4 text-center">
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{g.grNumber} <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>/ {g.doNumber}</span></p>
                  <div className="mt-1"><span className={`badge ${GR_BADGE[g.status].cls}`}>{GR_BADGE[g.status].label}</span></div>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>{g.supplierName} · dari {g.poNumber}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDateDisplay(g.receivedDate)}{g.supplierDoNumber ? ` · DO supplier ${g.supplierDoNumber}` : ''}</p>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>{grItemsText(g)}</p>
                  <p className="text-base font-extrabold tabular mt-2" style={{ color: 'var(--success)' }}>{formatRp(g.total)}</p>
                </div>
                <div className="flex items-center justify-center gap-1 flex-wrap px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>{grActions(g)}</div>
                {g.status === 'dibatalkan' && g.cancelNote && <p className="text-xs text-center px-4 pb-3 italic" style={{ color: 'var(--text-muted)' }}>Alasan batal: {g.cancelNote}</p>}
              </div>
              {historyId === g.id && <RecordHistoryPanel creds={creds} entity="goods-receipts" entityId={g.id} />}
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} {view === 'po' ? 'PO' : 'GR'} · halaman {safePage} dari {totalPages}</p>
            <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); setPage(1); }} />
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft size={14} /></button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                .map((n, i, arr) => (
                  <span key={n} className="flex items-center gap-1">
                    {i > 0 && arr[i - 1] !== n - 1 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>…</span>}
                    <button onClick={() => setPage(n)} className="w-8 h-8 rounded-lg text-xs font-bold"
                      style={safePage === n ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>{n}</button>
                  </span>
                ))}
              <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* ════ MODAL: FORM PO ════ */}
      {showPoForm && (
        <div className="modal-overlay" onClick={() => !savingPo && setShowPoForm(false)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ClipboardList size={17} /></div>
                <div>
                  <p className="modal-title">{editingPo ? `Edit ${editingPo.poNumber}` : 'Buat Purchase Order'}</p>
                  <p className="modal-subtitle">PO belum mengubah stok — stok masuk saat GR di-approve</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowPoForm(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Supplier</label>
                    <SearchSelect value={fSupplierId}
                      onChange={id => {
                        setFSupplierId(id);
                        const s = suppliers.find(ss => ss.id === id);
                        if (s) { setFSupplierName(s.name); setFSupplierPhone(s.phone ?? ''); }
                      }}
                      options={supplierOptions} placeholder="– Pilih Supplier –" searchPlaceholder="Cari supplier…" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Nama Supplier <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="text" value={fSupplierName} onChange={e => setFSupplierName(e.target.value)} placeholder="Isi manual kalau tidak terdaftar" className="input" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label style={fieldLabel}>No. WhatsApp Supplier</label>
                    <input type="tel" value={fSupplierPhone} onChange={e => setFSupplierPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="input" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Tanggal PO <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Estimasi Tiba</label>
                    <input type="date" value={fExpected} onChange={e => setFExpected(e.target.value)} className="input" />
                  </div>
                </div>

                <div>
                  <label style={fieldLabel}>Bahan Baku Dipesan</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {fRows.map((row, i) => {
                      const material = materials.find(m => m.id === row.materialId);
                      const qty = parseFloat(row.qty) || 0;
                      const price = parseFloat(row.price) || 0;
                      return (
                        <div key={i} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center gap-2 mb-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={row.materialId}
                                onChange={id => {
                                  const m = materials.find(mm => mm.id === id);
                                  // Harga awal = harga rata-rata saat ini sebagai patokan; boleh diubah.
                                  updateRow(i, { materialId: id, ...(m && !row.price && m.avgCost > 0 ? { price: String(Math.round(m.avgCost)) } : {}) });
                                }}
                                options={materialOptions} placeholder="– Bahan baku –" searchPlaceholder="Cari bahan baku…" />
                            </div>
                            <Tooltip label="Hapus baris">
                              <button onClick={() => setFRows(prev => prev.filter((_, idx) => idx !== i))} disabled={fRows.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}><X size={14} /></button>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label style={fieldLabel}>{`Qty${material ? ` (${material.unit})` : ''}`}</label>
                              <input type="number" min="0" value={row.qty} onChange={e => updateRow(i, { qty: e.target.value })} placeholder="0" className="input" />
                            </div>
                            <div>
                              <label style={fieldLabel}>Harga/satuan</label>
                              <NumberInput value={row.price} onChange={raw => updateRow(i, { price: raw })} placeholder="0" />
                            </div>
                          </div>
                          {qty > 0 && price > 0 && <p className="text-xs tabular mt-2" style={{ color: 'var(--text-muted)' }}>Subtotal: {formatRp(qty * price)}</p>}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setFRows(prev => [...prev, { materialId: '', qty: '', price: '' }])} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Bahan Baku
                  </button>
                </div>

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={fNote} onChange={e => setFNote(e.target.value)} placeholder="Catatan untuk supplier (opsional)" className="input" />
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total PO</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(poTotal)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowPoForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={savePo} disabled={savingPo || !canSavePo} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingPo ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {savingPo ? 'Menyimpan…' : editingPo ? 'Simpan Perubahan' : 'Simpan PO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL: FORM GR ════ */}
      {editingGr && (
        <div className="modal-overlay" onClick={() => !savingGr && setEditingGr(null)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><PackageCheck size={17} /></div>
                <div>
                  <p className="modal-title">{editingGr.grNumber} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>/ {editingGr.doNumber}</span></p>
                  <p className="modal-subtitle">Dari {editingGr.poNumber} · {editingGr.supplierName}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setEditingGr(null)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>No. DO dari Supplier</label>
                    <input type="text" value={gSupplierDo} onChange={e => setGSupplierDo(e.target.value)} placeholder="Nomor surat jalan supplier" className="input" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Tanggal Terima <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="date" value={gDate} onChange={e => setGDate(e.target.value)} className="input" />
                  </div>
                </div>

                <div>
                  <label style={fieldLabel}>Barang yang Benar-benar Datang</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {gRows.map((row, i) => (
                      <div key={row.materialId} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                        <p className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                          {row.name} <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>· sisa PO {formatQty(row.orderedQty)} {row.unit}</span>
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label style={fieldLabel}>{`Qty diterima (${row.unit})`}</label>
                            <input type="number" min="0" value={row.qty} onChange={e => setGRows(prev => prev.map((r, idx) => idx === i ? { ...r, qty: e.target.value } : r))} placeholder="0" className="input" />
                          </div>
                          <div>
                            <label style={fieldLabel}>Harga/satuan (sesuai nota)</label>
                            <NumberInput value={row.price} onChange={raw => setGRows(prev => prev.map((r, idx) => idx === i ? { ...r, price: raw } : r))} placeholder="0" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Isi 0 untuk bahan yang belum datang — sisanya tetap terbuka di PO untuk GR berikutnya.</p>
                </div>

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={gNote} onChange={e => setGNote(e.target.value)} placeholder="Catatan penerimaan (opsional)" className="input" />
                </div>

                <div>
                  <label style={fieldLabel}>Dompet Sumber {canApprove && <span style={{ color: 'var(--danger)' }}>*</span>}</label>
                  <SearchSelect value={gWallet} onChange={setGWallet} options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                  {gWallet && <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Saldo saat ini: {formatRp(walletBalances[gWallet] ?? 0)}</p>}
                </div>

                <div>
                  <label style={fieldLabel}>Status Pembayaran</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['lunas', 'belum_lunas'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setGPayment(s)} className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                        style={gPayment === s ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {s === 'lunas' ? 'Lunas' : 'Belum Lunas'}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    {gPayment === 'belum_lunas'
                      ? 'Stok bertambah saat approve, tapi baru tercatat sebagai Pengeluaran saat ditandai Lunas di tab Pembelian.'
                      : 'Saat approve, pengeluaran otomatis tercatat dari dompet ini.'}
                  </p>
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Diterima</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(grTotal)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => saveGr(false)} disabled={savingGr} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                {savingGr ? <Loader2 size={14} className="animate-spin" /> : null} Simpan Draft
              </button>
              {canApprove && (
                <button onClick={() => saveGr(true)} disabled={savingGr || !gWallet} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                  {savingGr ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Simpan & Approve
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL: BATAL ════ */}
      {cancelTarget && (
        <div className="modal-overlay" onClick={() => !cancelling && setCancelTarget(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Ban size={17} /></div>
                <div><p className="modal-title">Batalkan {cancelTarget.label}?</p></div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setCancelTarget(null)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>{cancelTarget.warn}</p>
              <label style={fieldLabel}>Alasan {cancelTarget.needReason && <span style={{ color: 'var(--danger)' }}>*</span>}</label>
              <textarea value={cancelNote} onChange={e => setCancelNote(e.target.value)} rows={3} className="input" placeholder="Alasan pembatalan" />
            </div>
            <div className="modal-footer">
              <button onClick={() => setCancelTarget(null)} disabled={cancelling} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Kembali</button>
              <button onClick={doCancel} disabled={cancelling} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0', background: 'var(--danger)' }}>
                {cancelling ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Ya, Batalkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
