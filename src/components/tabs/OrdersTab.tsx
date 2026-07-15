'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, RefreshCw, Trash2, ChevronDown, ChevronUp, Receipt, TrendingUp, ShoppingBag, FileSpreadsheet, Upload } from 'lucide-react';
import ExcelJS from 'exceljs';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';

interface OrderItem { name: string; weight: string; qty: number; price: number; subtotal: number; }
interface Order {
  id: string; invoiceNo: string; date: string; customerName: string; customerPhone: string;
  items: OrderItem[]; subtotal: number; discount?: { amount: number; label: string };
  total: number; pdfUrl?: string; status: string; createdAt?: { seconds: number };
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

function formatDate(o: Order) {
  if (o.createdAt?.seconds)
    return new Date(o.createdAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return o.date ?? '–';
}

// ─── Excel import ─────────────────────────────────────────────────────────────
const ORDER_TEMPLATE_COLS = [
  { header: 'No. Invoice',    key: 'invoiceNo',     width: 18 },
  { header: 'Tanggal',        key: 'date',          width: 16 },
  { header: 'Nama Pelanggan*', key: 'customerName', width: 24 },
  { header: 'No. HP',         key: 'customerPhone', width: 18 },
  { header: 'Produk',         key: 'itemsText',     width: 36 },
  { header: 'Subtotal',       key: 'subtotal',      width: 16 },
  { header: 'Diskon',         key: 'discount',      width: 14 },
  { header: 'Total*',         key: 'total',         width: 16 },
  { header: 'Status',         key: 'status',        width: 14 },
] as const;

type OrderTemplateKey = typeof ORDER_TEMPLATE_COLS[number]['key'];

function detectOrderColumn(header: string): OrderTemplateKey | null {
  const h = header.toLowerCase();
  if (h.includes('invoice')) return 'invoiceNo';
  if (h.includes('tanggal') || h.includes('date')) return 'date';
  if (h.includes('pelanggan') || h.includes('customer')) return 'customerName';
  if (h.includes('hp') || h.includes('whatsapp') || h.includes('telp') || h.includes('phone')) return 'customerPhone';
  if (h.includes('produk') || h.includes('item')) return 'itemsText';
  if (h.includes('subtotal')) return 'subtotal';
  if (h.includes('diskon') || h.includes('discount')) return 'discount';
  if (h.includes('total')) return 'total';
  if (h.includes('status')) return 'status';
  return null;
}

export default function OrdersTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [orders,     setOrders]     = useState<Order[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useViewMode('orders');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const headers = { 'x-admin-auth': creds };

  const load = async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/orders`, { headers });
    if (r.ok) { const { orders: o } = await r.json() as { orders: Order[] }; setOrders(o); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const del = async (id: string) => {
    if (!await confirm({ message: 'Hapus pesanan ini? Tindakan ini tidak bisa dibatalkan.', danger: true })) return;
    const r = await fetch(`${API}/api/orders/${id}`, { method: 'DELETE', headers });
    if (r.ok) {
      setOrders(o => o.filter(x => x.id !== id));
      toast.success('Pesanan berhasil dihapus.');
    } else {
      toast.error('Gagal menghapus pesanan.');
    }
  };

  const exportExcel = async (rows: Order[]) => {
    if (rows.length === 0) { toast.error('Tidak ada pesanan untuk diexport.'); return; }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Pesanan');

      const COLS = [
        { header: 'No',          key: 'no',        width: 6  },
        { header: 'No. Invoice', key: 'invoiceNo', width: 18 },
        { header: 'Tanggal',     key: 'date',      width: 20 },
        { header: 'Pelanggan',   key: 'customer',  width: 24 },
        { header: 'No. HP',      key: 'phone',     width: 18 },
        { header: 'Produk',      key: 'items',     width: 40 },
        { header: 'Jml Produk',  key: 'itemCount', width: 12 },
        { header: 'Subtotal',    key: 'subtotal',  width: 16 },
        { header: 'Diskon',      key: 'discount',  width: 16 },
        { header: 'Total',       key: 'total',     width: 16 },
        { header: 'Status',      key: 'status',    width: 14 },
      ];
      const colCount = COLS.length;
      ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = 'LAPORAN PESANAN — CEMILAN TEH RISMA';
      titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;

      ws.mergeCells(2, 1, 2, colCount);
      const subCell = ws.getCell(2, 1);
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      const totalOmzet = rows.reduce((s, o) => s + (o.total ?? 0), 0);
      subCell.value = `${rows.length} pesanan · Total omzet ${formatRp(totalOmzet)} · Diexport ${todayLabel}`;
      subCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      subCell.alignment = { horizontal: 'center', vertical: 'middle' };
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const HEADER_ROW_NUM = 3;
      const headerRow = ws.getRow(HEADER_ROW_NUM);
      COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFC96018' } },
          bottom: { style: 'thin', color: { argb: 'FFC96018' } },
          left: { style: 'thin', color: { argb: 'FFC96018' } },
          right: { style: 'thin', color: { argb: 'FFC96018' } },
        };
      });
      ws.views = [{ state: 'frozen', ySplit: HEADER_ROW_NUM }];

      rows.forEach((o, i) => {
        const itemsText = (o.items ?? []).map(it => `${it.name} (${it.weight}) ×${it.qty}`).join(', ');
        const row = ws.addRow({
          no: i + 1,
          invoiceNo: o.invoiceNo || '-',
          date: formatDate(o),
          customer: o.customerName || '-',
          phone: o.customerPhone || '-',
          items: itemsText || '-',
          itemCount: o.items?.length ?? 0,
          subtotal: o.subtotal ?? o.total,
          discount: o.discount?.amount ?? 0,
          total: o.total,
          status: o.status || '-',
        });

        const zebraFill = i % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF';
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraFill } };
          cell.border = {
            top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right:  { style: 'thin', color: { argb: 'FFE5E7EB' } },
          };
          cell.alignment = { vertical: 'middle', wrapText: false };
        });

        row.getCell('no').alignment        = { horizontal: 'center', vertical: 'middle' };
        row.getCell('itemCount').alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell('status').alignment    = { horizontal: 'center', vertical: 'middle' };
        row.getCell('items').alignment     = { horizontal: 'left', vertical: 'top', wrapText: true };
        ['subtotal', 'discount', 'total'].forEach(key => {
          const cell = row.getCell(key);
          cell.numFmt = '"Rp"#,##0';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        });
      });

      const lastColLetter = ws.getColumn(colCount).letter;
      ws.autoFilter = { from: `A${HEADER_ROW_NUM}`, to: `${lastColLetter}${HEADER_ROW_NUM}` };

      ws.columns.forEach(column => {
        let maxLen = 8;
        for (let r = HEADER_ROW_NUM; r <= ws.rowCount; r++) {
          const v = ws.getRow(r).getCell(column.number!).value;
          const len = v == null ? 0 : v.toString().length;
          if (len > maxLen) maxLen = len;
        }
        column.width = Math.min(maxLen + 2, 50);
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pesanan-cemilantehrisma-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Berhasil export ${rows.length} pesanan ke Excel.`);
    } catch {
      toast.error('Gagal membuat file Excel.');
    } finally {
      setExporting(false);
    }
  };

  const downloadOrderTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cemilan Teh Risma Admin';
    wb.created = new Date();
    const ws = wb.addWorksheet('Template Pesanan');
    const colCount = ORDER_TEMPLATE_COLS.length;
    ws.columns = ORDER_TEMPLATE_COLS.map(c => ({ key: c.key, width: c.width }));

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'TEMPLATE IMPORT DATA PESANAN — CEMILAN TEH RISMA';
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const noteCell = ws.getCell(2, 1);
    noteCell.value =
      'PETUNJUK: Kolom bertanda (*) wajib diisi. Jangan mengubah judul kolom di baris 3. '
      + 'Kolom Tanggal diisi format tgl/bln/tahun, contoh: 15/07/2026 (kosong = tanggal hari ini). '
      + 'Kolom No. Invoice boleh dikosongkan — akan dibuat otomatis. '
      + 'Kolom Produk cukup diisi ringkasan nama produk (bebas), bukan rincian per baris.';
    noteCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
    ws.getRow(2).height = 46;

    const HEADER_ROW_NUM = 3;
    const headerRow = ws.getRow(HEADER_ROW_NUM);
    ORDER_TEMPLATE_COLS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
    headerRow.height = 24;
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFC96018' } },
        bottom: { style: 'thin', color: { argb: 'FFC96018' } },
        left: { style: 'thin', color: { argb: 'FFC96018' } },
        right: { style: 'thin', color: { argb: 'FFC96018' } },
      };
    });
    ws.views = [{ state: 'frozen', ySplit: HEADER_ROW_NUM }];

    const exampleRow = ws.addRow({
      invoiceNo: '', date: '15/07/2026', customerName: 'Budi Santoso', customerPhone: '081234567890',
      itemsText: 'Keripik Talas (100g) ×2, Mie Kremes (150g) ×1', subtotal: 45000, discount: 5000,
      total: 40000, status: 'selesai',
    });
    exampleRow.eachCell(cell => { cell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-pesanan.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importOrdersFromExcel = async (file: File) => {
    setImporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) { toast.error('File Excel tidak valid.'); return; }

      let headerRowNum = -1;
      let colField = new Map<number, OrderTemplateKey>();
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const map = new Map<number, OrderTemplateKey>();
        ws.getRow(r).eachCell((cell, colNumber) => {
          const field = detectOrderColumn(cell.value?.toString() ?? '');
          if (field) map.set(colNumber, field);
        });
        const fields = new Set(map.values());
        if (fields.has('customerName') || fields.has('total')) { headerRowNum = r; colField = map; break; }
      }
      if (headerRowNum === -1) {
        toast.error('Kolom "Nama Pelanggan" atau "Total" tidak ditemukan. Gunakan template yang disediakan.');
        return;
      }

      const rows: Record<string, unknown>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const raw: Record<string, string> = Object.fromEntries(ORDER_TEMPLATE_COLS.map(c => [c.key, '']));
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const field = colField.get(colNumber);
          if (!field) return;
          raw[field] = cell.value?.toString().trim() ?? '';
        });
        if (!raw.customerName.trim()) return;
        rows.push({
          invoiceNo: raw.invoiceNo, date: raw.date, customerName: raw.customerName, customerPhone: raw.customerPhone,
          itemsText: raw.itemsText,
          subtotal: Number(raw.subtotal.replace(/[^0-9.-]/g, '')) || undefined,
          discount: Number(raw.discount.replace(/[^0-9.-]/g, '')) || undefined,
          total: Number(raw.total.replace(/[^0-9.-]/g, '')) || 0,
          status: raw.status,
        });
      });

      if (rows.length === 0) {
        toast.error('Tidak ada data pesanan valid pada file tersebut. Pastikan kolom Nama Pelanggan dan Total terisi.');
        return;
      }

      const r = await fetch(`${API}/api/orders/bulk-import`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: rows }),
      });
      if (r.ok) {
        const d = await r.json() as { created: number; skippedInvalid: number; skippedDuplicate: number };
        await load();
        const extra = [
          d.skippedDuplicate > 0 ? `${d.skippedDuplicate} No. Invoice duplikat dilewati` : '',
          d.skippedInvalid   > 0 ? `${d.skippedInvalid} baris tidak lengkap dilewati` : '',
        ].filter(Boolean).join(', ');
        toast.success(`${d.created} pesanan berhasil diimpor.${extra ? ` (${extra})` : ''}`);
      } else {
        const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
        toast.error(d.error ?? 'Gagal mengimpor data pesanan.');
      }
    } catch {
      toast.error('Gagal membaca file Excel. Pastikan format sesuai template.');
    } finally {
      setImporting(false);
    }
  };

  const totalRevenue = orders.reduce((s, o) => s + (o.total ?? 0), 0);
  const avgOrder     = orders.length ? totalRevenue / orders.length : 0;

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={downloadOrderTemplate} className="btn-ghost text-xs" style={{ height: 34 }}>
            <FileSpreadsheet size={13} /> <span className="hidden sm:inline">Unduh Template</span><span className="sm:hidden">Template</span>
          </button>
          <button onClick={() => importFileRef.current?.click()} disabled={importing} className="btn-ghost text-xs" style={{ height: 34 }}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            <span className="hidden sm:inline">{importing ? 'Mengimpor…' : 'Upload Excel'}</span>
            <span className="sm:hidden">Upload</span>
          </button>
          <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importOrdersFromExcel(f); e.target.value = ''; }} />
          {orders.length > 0 && (
            <button onClick={() => exportExcel(orders)} disabled={exporting} className="btn-ghost text-xs" style={{ height: 34 }}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
              <span className="hidden sm:inline">Export Excel</span><span className="sm:hidden">Export</span>
            </button>
          )}
          <ViewToggle mode={view} onChange={setView} />
          <button onClick={load} disabled={loading} className="btn-ghost p-2.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <ShoppingBag size={16}/>, label: 'Total Transaksi', val: orders.length.toString(), sub: 'pesanan' },
          { icon: <TrendingUp  size={16}/>, label: 'Total Omzet',     val: formatRp(totalRevenue), sub: 'dari semua pesanan' },
          { icon: <Receipt     size={16}/>, label: 'Rata-rata Order', val: formatRp(avgOrder), sub: 'per transaksi' },
        ].map((c, i) => (
          <div key={i} className="card relative p-4 overflow-hidden">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              {c.icon}
            </div>
            <p className="text-lg font-extrabold tabular leading-tight" style={{ color: 'var(--text-primary)' }}>{c.val}</p>
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            <div className="stat-card-accent" />
          </div>
        ))}
      </div>

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🧾</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada pesanan</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pesanan dari tab Kasir akan muncul di sini otomatis.</p>
        </div>
      ) : view === 'table' ? (
        <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
          {orders.map(o => (
            <div key={o.id}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--accent-bg)' }}>
                  <Receipt size={17} style={{ color: 'var(--accent)' }} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                  <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                    {o.invoiceNo} · {formatDate(o)}
                  </p>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.items?.length ?? 0} produk</p>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)} className="btn-ghost p-2">
                    {expandedId === o.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  <button onClick={() => del(o.id)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {expandedId === o.id && <OrderDetail o={o} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map(o => (
            <div key={o.id} className="card overflow-hidden">
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent-bg)' }}>
                    <Receipt size={17} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{o.customerName}</p>
                    <p className="text-xs tabular truncate" style={{ color: 'var(--text-muted)' }}>
                      {o.invoiceNo} · {formatDate(o)}
                    </p>
                  </div>
                  <button onClick={() => del(o.id)} className="btn-ghost p-2 flex-shrink-0" style={{ color: 'var(--danger)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <div>
                    <p className="text-base font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{o.items?.length ?? 0} produk</p>
                  </div>
                  <button onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                    className="btn-ghost px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1">
                    Detail {expandedId === o.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>
              </div>

              {expandedId === o.id && <OrderDetail o={o} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ o }: { o: Order }) {
  return (
    <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-2)' }}>
      <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>📞 {o.customerPhone}</p>

      <div className="space-y-1.5">
        {o.items?.map((item, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span style={{ color: 'var(--text-secondary)' }}>
              {item.name} <span style={{ color: 'var(--text-muted)' }}>({item.weight})</span> × {item.qty}
            </span>
            <span className="font-bold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(item.subtotal)}</span>
          </div>
        ))}
      </div>

      {o.discount && o.discount.amount > 0 && (
        <div className="flex justify-between text-xs">
          <span style={{ color: 'var(--success)' }}>Diskon ({o.discount.label})</span>
          <span className="font-bold tabular" style={{ color: 'var(--success)' }}>− {formatRp(o.discount.amount)}</span>
        </div>
      )}

      <div className="flex justify-between text-sm font-bold pt-2"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        <span>Total</span>
        <span className="tabular" style={{ color: 'var(--accent)' }}>{formatRp(o.total)}</span>
      </div>

      {o.pdfUrl && (
        <a href={o.pdfUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--accent)' }}>
          <Receipt size={12} /> Lihat Invoice PDF →
        </a>
      )}
    </div>
  );
}
