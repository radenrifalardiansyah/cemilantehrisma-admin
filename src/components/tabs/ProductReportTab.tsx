'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
} from 'recharts';
import {
  Loader2, RefreshCw, Search, Package, Boxes, TrendingUp, ShoppingCart, Globe, Store,
  ChevronLeft, ChevronRight, LineChart as LineChartIcon,
} from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import { pdf } from '@react-pdf/renderer';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import ViewToggle from '@/components/ViewToggle';
import PageSizeSelect from '@/components/PageSizeSelect';
import { useToast } from '@/components/Toast';
import { useViewMode } from '@/lib/useViewMode';
import { type PeriodKey, PERIOD_OPTIONS, periodRange } from '@/lib/period';
import ProductReportPDF from '@/lib/pdf/ProductReportPDF';
import GenericTablePDF from '@/lib/pdf/GenericTablePDF';
import { toDataUri } from '@/lib/pdf/logo';
import PageLoader from '@/components/PageLoader';

const API = '';
const HEADER_BTN_H = 34;

// Palet kategorikal 4-slot, urutan tetap (bukan berdasar urutan seleksi) — supaya produk yang
// tetap tampil tidak berganti warna saat produk lain di-toggle. Sudah divalidasi lolos cek CVD
// adjacent DAN all-pairs (light & dark) via dataviz skill's validate_palette.js.
const TREND_COLORS = ['#0284C7', '#D4691E', '#7C3AED', '#DB2777'];

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const formatQty = (n: number) => new Intl.NumberFormat('id-ID').format(n);
// HPP per pcs = total HPP ÷ qty berbayar (qty gratis tidak dihitung, HPP-nya juga tidak masuk Total HPP).
const hppPerPcs = (cogs: number, qty: number, qtyFree = 0) => qty - qtyFree > 0 ? Math.round(cogs / (qty - qtyFree)) : 0;

function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function TrendTooltip({ active, payload, label }: {
  active?: boolean; label?: string; payload?: { name?: string; value?: number; color?: string }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: 'var(--text-primary)', color: 'white', padding: '10px 12px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
    }}>
      {label && <div style={{ opacity: 0.65, marginBottom: 4, fontWeight: 700 }}>{shortDate(label)}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ opacity: 0.75 }}>{p.name}:</span>
          <span style={{ fontWeight: 800 }}>{formatQty(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

interface ProductRow {
  productId: string; name: string;
  qtyPos: number; qtyOnline: number; qtyConsignment: number; qtyTotal: number;
  revenue: number; cogs: number; qtyFree: number; cogsFree: number;
}
interface TrendProduct { key: string; name: string }
interface ProductMeta { emoji: string; imageUrls?: string[]; bgColor: string; category?: string }
interface Category { id: string; name: string; emoji: string }

export default function ProductReportTab({ creds }: { creds: string }) {
  const headers = { 'x-admin-auth': creds };
  const toast = useToast();

  const [period,     setPeriod]     = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [search,     setSearch]     = useState('');
  const [view, setView] = useViewMode('product-report');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [loading,  setLoading]  = useState(true);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [exporting, setExporting] = useState(false);

  const [trendProducts, setTrendProducts] = useState<TrendProduct[]>([]);
  const [dailyTrend, setDailyTrend] = useState<Record<string, string | number>[]>([]);
  const [hiddenTrendKeys, setHiddenTrendKeys] = useState<Set<string>>(new Set());
  const toggleTrendKey = (key: string) => setHiddenTrendKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const [productMeta, setProductMeta] = useState<Map<string, ProductMeta>>(new Map());
  const [categories, setCategories]   = useState<Category[]>([]);
  const [printingPdf, setPrintingPdf] = useState(false);
  const [exportingTrend, setExportingTrend] = useState(false);
  const [printingTrendPdf, setPrintingTrendPdf] = useState(false);

  const [storeInfo, setStoreInfo] = useState<{ storeName?: string; storeTagline?: string; address?: string; city?: string; whatsapp?: string; logo?: string }>({});
  const [logoDataUri, setLogoDataUri] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch(`${API}/api/products`, { headers }).then(async r => {
      if (!r.ok) return;
      const { products: prods } = await r.json() as { products: { id: string; emoji: string; imageUrls?: string[]; bgColor: string; category?: string }[] };
      setProductMeta(new Map(prods.map(p => [p.id, { emoji: p.emoji, imageUrls: p.imageUrls, bgColor: p.bgColor, category: p.category }])));
    }).catch(() => {});
    fetch(`${API}/api/categories`, { headers }).then(async r => {
      if (!r.ok) return;
      const { categories: cats } = await r.json() as { categories: Category[] };
      setCategories(cats);
    }).catch(() => {});
    fetch(`${API}/api/settings`, { headers }).then(async r => {
      if (r.ok) setStoreInfo((await r.json() as { settings: typeof storeInfo }).settings ?? {});
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { toDataUri(storeInfo.logo).then(setLogoDataUri); }, [storeInfo.logo]);

  const storeHeader = {
    name:    storeInfo.storeName?.trim() || 'Cemilan Teh Risma',
    tagline: storeInfo.storeTagline?.trim() || undefined,
    address: [storeInfo.address, storeInfo.city].filter(Boolean).join(', ') || undefined,
    phone:   storeInfo.whatsapp?.trim() || undefined,
    logo:    logoDataUri,
  };

  const catName  = (id?: string) => categories.find(c => c.id === id)?.name;
  const catEmoji = (id?: string) => categories.find(c => c.id === id)?.emoji ?? '🏷️';

  const { from, to } = periodRange(period, customFrom, customTo);

  // Generasi request — cegah respons periode LAMA yang datang belakangan menimpa data periode
  // BARU yang sudah lebih dulu tampil (pola sama seperti FinanceReportTab).
  const loadIdRef = useRef(0);
  const load = async () => {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/analytics/product-report?from=${from}&to=${to}`, { headers });
      if (!res.ok) return;
      const data = await res.json() as {
        products: ProductRow[]; totalQty: number; totalRevenue: number;
        trendProducts: TrendProduct[]; dailyTrend: Record<string, string | number>[];
      };
      if (myLoadId !== loadIdRef.current) return;
      setProducts(data.products);
      setTotalQty(data.totalQty);
      setTotalRevenue(data.totalRevenue);
      setTrendProducts(data.trendProducts);
      setDailyTrend(data.dailyTrend);
      setHiddenTrendKeys(new Set());
    } finally { if (myLoadId === loadIdRef.current) setLoading(false); }
  };
  useEffect(() => { load(); }, [period, customFrom, customTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayRows = search
    ? products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    : products;

  const totalPages = Math.max(1, Math.ceil(displayRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = displayRows.slice(
    Number.isFinite(pageSize) ? (safePage - 1) * pageSize : 0,
    Number.isFinite(pageSize) ? safePage * pageSize : displayRows.length,
  );
  const goPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

  // Total baris footer tabel — mengikuti hasil pencarian (semua halaman), bukan cuma yang tampil
  // di halaman saat ini, supaya konsisten dengan angka "N produk" di caption pagination.
  const footerTotals = displayRows.reduce((acc, p) => ({
    qtyPos: acc.qtyPos + p.qtyPos, qtyOnline: acc.qtyOnline + p.qtyOnline,
    qtyConsignment: acc.qtyConsignment + p.qtyConsignment, qtyTotal: acc.qtyTotal + p.qtyTotal,
    revenue: acc.revenue + p.revenue, cogs: acc.cogs + p.cogs,
    qtyFree: acc.qtyFree + p.qtyFree, cogsFree: acc.cogsFree + p.cogsFree,
  }), { qtyPos: 0, qtyOnline: 0, qtyConsignment: 0, qtyTotal: 0, revenue: 0, cogs: 0, qtyFree: 0, cogsFree: 0 });

  const periodLabel = PERIOD_OPTIONS.find(p => p.id === period)?.label ?? '';

  const exportExcel = async () => {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();

      const styleTitle = (ws: ExcelJS.Worksheet, title: string, subtitle: string, colCount: number) => {
        ws.mergeCells(1, 1, 1, colCount);
        const t = ws.getCell(1, 1);
        t.value = title; t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
        ws.getRow(1).height = 28;
        ws.mergeCells(2, 1, 2, colCount);
        const s = ws.getCell(2, 1);
        s.value = subtitle; s.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
        s.alignment = { horizontal: 'center', vertical: 'middle' };
        s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
        ws.getRow(2).height = 20;
      };
      const styleHeader = (ws: ExcelJS.Worksheet, rowNum: number, hdrs: string[]) => {
        const row = ws.getRow(rowNum);
        hdrs.forEach((h, i) => { row.getCell(i + 1).value = h; });
        row.height = 24;
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        ws.views = [{ state: 'frozen', ySplit: rowNum }];
      };
      const zebra = (ws: ExcelJS.Worksheet, rowNum: number, idx: number) => {
        ws.getRow(rowNum).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });
      };

      const ws = wb.addWorksheet('Laporan Produk');
      ws.columns = [
        { key: 'produk', width: 32 }, { key: 'kategori', width: 16 }, { key: 'kasir', width: 12 }, { key: 'online', width: 12 },
        { key: 'konsinyasi', width: 14 }, { key: 'total', width: 14 }, { key: 'omzet', width: 18 },
        { key: 'hppPcs', width: 14 }, { key: 'hpp', width: 18 }, { key: 'laba', width: 18 },
        { key: 'gratis', width: 12 }, { key: 'hppGratis', width: 18 },
      ];
      styleTitle(ws, 'LAPORAN PRODUK TERJUAL — CEMILAN TEH RISMA', `Periode: ${periodLabel} (${from} s/d ${to})`, 12);
      styleHeader(ws, 3, ['Produk', 'Kategori', 'Kasir', 'Online', 'Konsinyasi', 'Total Qty', 'Omzet', 'HPP/pcs', 'Total HPP', 'Laba Kotor', 'Qty Gratis', 'HPP Gratis']);
      displayRows.forEach((p, i) => {
        const rowNum = 4 + i;
        const row = ws.getRow(rowNum);
        row.getCell(1).value = p.name;
        row.getCell(2).value = catName(productMeta.get(p.productId)?.category) ?? '';
        row.getCell(3).value = p.qtyPos;
        row.getCell(4).value = p.qtyOnline;
        row.getCell(5).value = p.qtyConsignment;
        row.getCell(6).value = p.qtyTotal;
        row.getCell(7).value = p.revenue;
        row.getCell(7).numFmt = '"Rp"#,##0';
        row.getCell(8).value = hppPerPcs(p.cogs, p.qtyTotal, p.qtyFree);
        row.getCell(8).numFmt = '"Rp"#,##0';
        row.getCell(9).value = p.cogs;
        row.getCell(9).numFmt = '"Rp"#,##0';
        row.getCell(10).value = p.revenue - p.cogs;
        row.getCell(10).numFmt = '"Rp"#,##0';
        row.getCell(11).value = p.qtyFree;
        row.getCell(12).value = p.cogsFree;
        row.getCell(12).numFmt = '"Rp"#,##0';
        zebra(ws, rowNum, i);
      });

      const totalRowNum = 4 + displayRows.length;
      const totalRow = ws.getRow(totalRowNum);
      totalRow.getCell(1).value = `Total (${displayRows.length} produk)`;
      totalRow.getCell(3).value = footerTotals.qtyPos;
      totalRow.getCell(4).value = footerTotals.qtyOnline;
      totalRow.getCell(5).value = footerTotals.qtyConsignment;
      totalRow.getCell(6).value = footerTotals.qtyTotal;
      totalRow.getCell(7).value = footerTotals.revenue;
      totalRow.getCell(7).numFmt = '"Rp"#,##0';
      totalRow.getCell(8).value = hppPerPcs(footerTotals.cogs, footerTotals.qtyTotal, footerTotals.qtyFree);
      totalRow.getCell(8).numFmt = '"Rp"#,##0';
      totalRow.getCell(9).value = footerTotals.cogs;
      totalRow.getCell(9).numFmt = '"Rp"#,##0';
      totalRow.getCell(10).value = footerTotals.revenue - footerTotals.cogs;
      totalRow.getCell(10).numFmt = '"Rp"#,##0';
      totalRow.getCell(11).value = footerTotals.qtyFree;
      totalRow.getCell(12).value = footerTotals.cogsFree;
      totalRow.getCell(12).numFmt = '"Rp"#,##0';
      totalRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8CF' } };
        cell.border = { top: { style: 'medium', color: { argb: 'FFC96018' } } };
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-produk-${from}-sd-${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  // Tren harian: semua produk top-4 diekspor (bukan hanya yang garisnya sedang tampil), karena
  // menyembunyikan garis cuma pengaturan tampilan grafik.
  const trendTotals = trendProducts.map(p => dailyTrend.reduce((sum, d) => sum + Number(d[p.key] ?? 0), 0));

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportTrendExcel = async () => {
    setExportingTrend(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Cemilan Teh Risma Admin';
      wb.created = new Date();
      const ws = wb.addWorksheet('Tren Harian');
      const colCount = trendProducts.length + 2;
      ws.columns = [{ key: 'tanggal', width: 16 }, ...trendProducts.map(p => ({ key: p.key, width: Math.max(16, p.name.length + 2) })), { key: 'total', width: 12 }];

      ws.mergeCells(1, 1, 1, colCount);
      const t = ws.getCell(1, 1);
      t.value = 'TREN HARIAN PRODUK TERLARIS — CEMILAN TEH RISMA';
      t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC96018' } };
      ws.getRow(1).height = 28;
      ws.mergeCells(2, 1, 2, colCount);
      const sub = ws.getCell(2, 1);
      sub.value = `Periode: ${periodLabel} (${from} s/d ${to}) · Qty terjual per hari`;
      sub.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      sub.alignment = { horizontal: 'center', vertical: 'middle' };
      sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2E9' } };
      ws.getRow(2).height = 20;

      const head = ws.getRow(3);
      ['Tanggal', ...trendProducts.map(p => p.name), 'Total'].forEach((h, i) => { head.getCell(i + 1).value = h; });
      head.height = 24;
      head.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8821A' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];

      const line = { style: 'thin' as const, color: { argb: 'FFE5E7EB' } };
      dailyTrend.forEach((d, i) => {
        const row = ws.getRow(4 + i);
        row.getCell(1).value = String(d.date);
        let rowTotal = 0;
        trendProducts.forEach((p, pi) => {
          const q = Number(d[p.key] ?? 0);
          rowTotal += q;
          row.getCell(pi + 2).value = q;
        });
        row.getCell(colCount).value = rowTotal;
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFF7ED' : 'FFFFFFFF' } };
          cell.border = { top: line, bottom: line, left: line, right: line };
          if (col > 1) cell.alignment = { horizontal: 'right' };
        });
      });

      const totalRow = ws.getRow(4 + dailyTrend.length);
      totalRow.getCell(1).value = 'Total';
      trendTotals.forEach((q, i) => { totalRow.getCell(i + 2).value = q; });
      totalRow.getCell(colCount).value = trendTotals.reduce((a, b) => a + b, 0);
      totalRow.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8CF' } };
        cell.border = { top: { style: 'medium', color: { argb: 'FFC96018' } } };
        if (col > 1) cell.alignment = { horizontal: 'right' };
      });

      const buffer = await wb.xlsx.writeBuffer();
      saveBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `tren-harian-produk-${from}-sd-${to}.xlsx`);
    } catch {
      toast.error('Gagal membuat file Excel tren harian.');
    } finally { setExportingTrend(false); }
  };

  const printTrendPdf = async () => {
    setPrintingTrendPdf(true);
    try {
      // Lebar kolom: Tanggal 16% + Total 12%, sisanya dibagi rata untuk produk.
      const prodWidth = `${(72 / Math.max(1, trendProducts.length)).toFixed(2)}%`;
      const rows: (string | number)[][] = dailyTrend.map(d => [
        shortDate(String(d.date)),
        ...trendProducts.map(p => Number(d[p.key] ?? 0)),
        trendProducts.reduce((sum, p) => sum + Number(d[p.key] ?? 0), 0),
      ]);
      rows.push(['Total', ...trendTotals, trendTotals.reduce((a, b) => a + b, 0)]);
      const blob = await pdf(
        <GenericTablePDF
          store={storeHeader}
          data={{
            title: 'TREN HARIAN PRODUK TERLARIS',
            label: `${periodLabel}: ${from} s/d ${to}, qty terjual per hari`,
            generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            columns: [
              { header: 'Tanggal', width: '16%', bold: true },
              ...trendProducts.map(p => ({ header: p.name, width: prodWidth, align: 'right' as const })),
              { header: 'Total', width: '12%', align: 'right' as const, bold: true },
            ],
            rows,
          }}
        />
      ).toBlob();
      saveBlob(blob, `tren-harian-produk-${from}-sd-${to}.pdf`);
    } catch {
      toast.error('Gagal membuat PDF tren harian.');
    } finally { setPrintingTrendPdf(false); }
  };

  const printReportPdf = async () => {
    setPrintingPdf(true);
    try {
      const rows = displayRows.map((p, i) => ({
        no: i + 1,
        productName: p.name,
        category: catName(productMeta.get(p.productId)?.category),
        qtyPos: p.qtyPos, qtyOnline: p.qtyOnline, qtyConsignment: p.qtyConsignment,
        qtyTotal: p.qtyTotal, revenue: p.revenue, cogs: p.cogs, qtyFree: p.qtyFree,
      }));
      const blob = await pdf(
        <ProductReportPDF
          store={storeHeader}
          data={{
            periodLabel, from, to,
            totalQty: footerTotals.qtyTotal, totalRevenue: footerTotals.revenue, totalCogs: footerTotals.cogs, totalQtyFree: footerTotals.qtyFree, totalCogsFree: footerTotals.cogsFree, jenisProduk: displayRows.length,
            rows,
          }}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-produk-${from}-sd-${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal membuat laporan PDF.');
    } finally {
      setPrintingPdf(false);
    }
  };

  // Muatan awal: loader saja (tanpa filter periode & tombol export) sampai data pertama selesai dimuat.
  // `booted` mencegah loader penuh menutup filter saat periode diganti (itu cukup loader di area konten).
  const [booted, setBooted] = useState(false);
  useEffect(() => { if (!loading) setBooted(true); }, [loading]);
  if (!booted) return <PageLoader />;

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={load} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      {/* Pemilih periode */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map(p => (
          <button key={p.id} onClick={() => { setPeriod(p.id); setPage(1); }}
            className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={period === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); }} className="input" style={{ height: 36 }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); }} className="input" style={{ height: 36 }} />
          </div>
        )}
      </div>

      {loading ? (
        <PageLoader compact />
      ) : (
        <div className="space-y-5">
          {/* Ringkasan */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--success-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(21,128,61,0.15)', color: 'var(--success)' }}>
                <Boxes size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: 'var(--success)' }}>{totalQty.toLocaleString('id-ID')}</p>
                <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Total Unit Terjual</p>
              </div>
            </div>
            <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--accent-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,105,30,0.15)', color: 'var(--accent)' }}>
                <TrendingUp size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: 'var(--accent)' }}>{formatRp(totalRevenue)}</p>
                <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Omzet dari Produk Terjual</p>
              </div>
            </div>
            <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--surface-2)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(2,132,199,0.15)', color: '#0284C7' }}>
                <Package size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: '#0284C7' }}>{products.length}</p>
                <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Jenis Produk Terjual</p>
              </div>
            </div>
            {footerTotals.qtyFree > 0 && (
              <div className="card p-4 sm:col-span-3" style={{ background: 'var(--surface-2)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Barang digratiskan: {footerTotals.qtyFree.toLocaleString('id-ID')} unit · HPP {formatRp(footerTotals.cogsFree)} (tidak dihitung di Total HPP)
                </p>
              </div>
            )}
          </div>

          {/* Tren harian — top 4 produk terlaris di periode ini */}
          {trendProducts.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                    <LineChartIcon size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tren Harian Produk Terlaris</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Klik nama produk untuk sembunyikan/tampilkan garisnya</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-[11px]">
                  <Tooltip label="Export Excel">
                    <button onClick={exportTrendExcel} disabled={exportingTrend} aria-label="Export Excel tren harian"
                      className="btn-ghost p-0 flex items-center justify-center flex-shrink-0" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {exportingTrend ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                    </button>
                  </Tooltip>
                  <Tooltip label="Cetak PDF">
                    <button onClick={printTrendPdf} disabled={printingTrendPdf} aria-label="Cetak PDF tren harian"
                      className="btn-ghost p-0 flex items-center justify-center flex-shrink-0" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                      {printingTrendPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                    </button>
                  </Tooltip>
                  {trendProducts.map((p, i) => {
                    const hidden = hiddenTrendKeys.has(p.key);
                    return (
                      <button key={p.key} onClick={() => toggleTrendKey(p.key)}
                        className="flex items-center gap-1.5 font-semibold transition-opacity"
                        style={{ color: hidden ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: hidden ? 0.5 : 1 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: TREND_COLORS[i], display: 'inline-block', flexShrink: 0 }} />
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={dailyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border-2)" strokeDasharray="3 4" />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} minTickGap={24} tickMargin={8} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={40} tickCount={5} />
                    <RTooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1.5, strokeDasharray: '4 4' }} />
                    {trendProducts.map((p, i) => !hiddenTrendKeys.has(p.key) && (
                      <Line key={p.key} type="monotone" dataKey={p.key} name={p.name}
                        stroke={TREND_COLORS[i]} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Search + toggle tampilan */}
          <div className="flex flex-row items-center gap-2 sm:gap-3">
            <div className="relative flex-1 min-w-0">
              <Search size={14} style={{
                position: 'absolute', left: 14, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
              }} />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="input text-sm w-full"
                style={{ paddingLeft: 38, height: HEADER_BTN_H }}
                placeholder="Cari produk…"
              />
            </div>
            {products.length > 0 && (
              <>
                <Tooltip label="Export Excel">
                  <button onClick={exportExcel} disabled={exporting || loading} aria-label="Export Excel"
                    className="btn-ghost p-0 flex items-center justify-center flex-shrink-0" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                    {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                  </button>
                </Tooltip>
                <Tooltip label="Cetak PDF">
                  <button onClick={printReportPdf} disabled={printingPdf || loading} aria-label="Cetak PDF"
                    className="btn-ghost p-0 flex items-center justify-center flex-shrink-0" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                    {printingPdf ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                  </button>
                </Tooltip>
              </>
            )}
            {products.length > 0 && <ViewToggle mode={view} onChange={setView} height={HEADER_BTN_H} />}
          </div>

          {displayRows.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
              <Package size={24} style={{ color: 'var(--text-muted)', margin: '0 auto 10px', display: 'block' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Tidak ada produk terjual di periode ini.</p>
            </div>
          ) : view === 'table' ? (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>Produk</th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>
                        <span className="inline-flex items-center gap-1"><ShoppingCart size={10} /> Kasir</span>
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>
                        <span className="inline-flex items-center gap-1"><Globe size={10} /> Online</span>
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>
                        <span className="inline-flex items-center gap-1"><Store size={10} /> Konsinyasi</span>
                      </th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>Total Qty</th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>Gratis</th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>Omzet</th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>HPP/pcs</th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>Total HPP</th>
                      <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>Laba Kotor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((p, i) => {
                      const meta = productMeta.get(p.productId);
                      return (
                        <tr key={p.productId || p.name} style={{ borderBottom: '1px solid var(--border-2)', background: i % 2 === 0 ? 'var(--surface)' : 'transparent' }}>
                          <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>
                            <div className="flex items-center gap-2.5 max-w-[260px]">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm relative overflow-hidden" style={{ background: `${meta?.bgColor ?? '#F5F0E9'}22` }}>
                                {meta?.imageUrls?.[0]
                                  ? <Image src={meta.imageUrls[0]} alt={p.name} fill className="object-contain" sizes="32px" unoptimized />
                                  : (meta?.emoji ?? '📦')}
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold truncate">{p.name}</p>
                                {catName(meta?.category) && <p className="text-[10.5px] truncate" style={{ color: 'var(--text-muted)' }}>{catName(meta?.category)}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyPos || '–'}</td>
                          <td className="px-3 py-2.5 text-right tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyOnline || '–'}</td>
                          <td className="px-3 py-2.5 text-right tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyConsignment || '–'}</td>
                          <td className="px-3 py-2.5 text-right font-extrabold tabular" style={{ color: 'var(--accent)' }}>{p.qtyTotal}</td>
                          <td className="px-3 py-2.5 text-right tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyFree || '–'}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{formatRp(p.revenue)}</td>
                          <td className="px-3 py-2.5 text-right tabular whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatRp(hppPerPcs(p.cogs, p.qtyTotal, p.qtyFree))}</td>
                          <td className="px-3 py-2.5 text-right tabular whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatRp(p.cogs)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular whitespace-nowrap" style={{ color: 'var(--success)' }}>{formatRp(p.revenue - p.cogs)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface-2)', borderTop: '2px solid var(--border-2)' }}>
                      <td className="px-3 py-2.5 font-bold" style={{ color: 'var(--text-primary)' }}>
                        Total ({displayRows.length} produk)
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{footerTotals.qtyPos || '–'}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{footerTotals.qtyOnline || '–'}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{footerTotals.qtyConsignment || '–'}</td>
                      <td className="px-3 py-2.5 text-right font-extrabold tabular" style={{ color: 'var(--accent)' }}>{footerTotals.qtyTotal}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{footerTotals.qtyFree || '–'}</td>
                      <td className="px-3 py-2.5 text-right font-extrabold tabular whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{formatRp(footerTotals.revenue)}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatRp(hppPerPcs(footerTotals.cogs, footerTotals.qtyTotal, footerTotals.qtyFree))}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatRp(footerTotals.cogs)}</td>
                      <td className="px-3 py-2.5 text-right font-extrabold tabular whitespace-nowrap" style={{ color: 'var(--success)' }}>{formatRp(footerTotals.revenue - footerTotals.cogs)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {paginatedRows.map(p => {
                const meta = productMeta.get(p.productId);
                return (
                  <div key={p.productId || p.name} className="card overflow-hidden flex flex-col">
                    <div className="relative w-full aspect-square flex items-center justify-center text-4xl" style={{ background: `${meta?.bgColor ?? '#F5F0E9'}22` }}>
                      {meta?.imageUrls?.[0]
                        ? <Image src={meta.imageUrls[0]} alt={p.name} fill className="object-contain" sizes="(max-width: 640px) 50vw, 200px" unoptimized />
                        : (meta?.emoji ?? '📦')}
                      <span className="absolute top-2 right-2 badge badge-amber" style={{ fontSize: 11 }}>{p.qtyTotal} terjual</span>
                    </div>
                    <div className="p-3 flex-1 flex flex-col gap-1.5">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                      {catName(meta?.category) && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full self-start"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                          {catEmoji(meta?.category)} {catName(meta?.category)}
                        </span>
                      )}
                      <p className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(p.revenue)}</p>
                      <p className="text-[10.5px] tabular" style={{ color: 'var(--text-muted)' }}>HPP {formatRp(hppPerPcs(p.cogs, p.qtyTotal, p.qtyFree))}/pcs · Total HPP {formatRp(p.cogs)} · Laba {formatRp(p.revenue - p.cogs)}{p.qtyFree > 0 && ` · Gratis ${p.qtyFree}`}</p>
                      <div className="grid grid-cols-3 gap-2 mt-auto pt-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                        <div className="text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wide flex items-center justify-center gap-0.5" style={{ color: 'var(--text-muted)' }}><ShoppingCart size={9} /> Kasir</p>
                          <p className="text-xs font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyPos}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wide flex items-center justify-center gap-0.5" style={{ color: 'var(--text-muted)' }}><Globe size={9} /> Online</p>
                          <p className="text-xs font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyOnline}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wide flex items-center justify-center gap-0.5" style={{ color: 'var(--text-muted)' }}><Store size={9} /> Mitra</p>
                          <p className="text-xs font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyConsignment}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {displayRows.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {displayRows.length} produk · halaman {safePage} dari {totalPages}
                </p>
                <PageSizeSelect value={pageSize} onChange={n => { setPageSize(n); setPage(1); }} />
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Tooltip label="Halaman sebelumnya">
                    <button onClick={() => goPage(safePage - 1)} disabled={safePage === 1} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronLeft size={14} />
                    </button>
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
                        : <button key={n} onClick={() => goPage(n as number)}
                            className="w-8 h-8 rounded-lg text-xs font-semibold transition-colors"
                            style={safePage === n
                              ? { background: 'var(--accent)', color: '#fff' }
                              : { color: 'var(--text-secondary)', background: 'var(--surface)' }}>
                            {n}
                          </button>
                    )
                  }
                  <Tooltip label="Halaman berikutnya">
                    <button onClick={() => goPage(safePage + 1)} disabled={safePage === totalPages} className="btn-ghost p-2 disabled:opacity-30">
                      <ChevronRight size={14} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
