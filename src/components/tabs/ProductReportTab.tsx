'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, RefreshCw, Search, Package, Boxes, TrendingUp, ShoppingCart, Globe, Store } from 'lucide-react';
import { ExcelIcon } from '@/components/FileTypeIcons';
import ExcelJS from 'exceljs';
import TopbarPortal from '@/components/TopbarPortal';
import Tooltip from '@/components/Tooltip';
import { type PeriodKey, PERIOD_OPTIONS, periodRange } from '@/lib/period';

const API = '';

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

interface ProductRow {
  productId: string; name: string;
  qtyPos: number; qtyOnline: number; qtyConsignment: number; qtyTotal: number;
  revenue: number;
}

export default function ProductReportTab({ creds }: { creds: string }) {
  const headers = { 'x-admin-auth': creds };

  const [period,     setPeriod]     = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [search,     setSearch]     = useState('');

  const [loading,  setLoading]  = useState(true);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [exporting, setExporting] = useState(false);

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
      const data = await res.json() as { products: ProductRow[]; totalQty: number; totalRevenue: number };
      if (myLoadId !== loadIdRef.current) return;
      setProducts(data.products);
      setTotalQty(data.totalQty);
      setTotalRevenue(data.totalRevenue);
    } finally { if (myLoadId === loadIdRef.current) setLoading(false); }
  };
  useEffect(() => { load(); }, [period, customFrom, customTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayRows = search
    ? products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    : products;

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
        { key: 'produk', width: 32 }, { key: 'kasir', width: 12 }, { key: 'online', width: 12 },
        { key: 'konsinyasi', width: 14 }, { key: 'total', width: 14 }, { key: 'omzet', width: 18 },
      ];
      styleTitle(ws, 'LAPORAN PRODUK TERJUAL — CEMILAN TEH RISMA', `Periode: ${periodLabel} (${from} s/d ${to})`, 6);
      styleHeader(ws, 3, ['Produk', 'Kasir', 'Online', 'Konsinyasi', 'Total Qty', 'Omzet']);
      displayRows.forEach((p, i) => {
        const rowNum = 4 + i;
        const row = ws.getRow(rowNum);
        row.getCell(1).value = p.name;
        row.getCell(2).value = p.qtyPos;
        row.getCell(3).value = p.qtyOnline;
        row.getCell(4).value = p.qtyConsignment;
        row.getCell(5).value = p.qtyTotal;
        row.getCell(6).value = p.revenue;
        row.getCell(6).numFmt = '"Rp"#,##0';
        zebra(ws, rowNum, i);
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

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <TopbarPortal>
        <Tooltip label="Export Excel">
          <button onClick={exportExcel} disabled={exporting || loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Export Excel">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
          </button>
        </Tooltip>
        <Tooltip label="Refresh">
          <button onClick={load} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </TopbarPortal>

      {/* Pemilih periode */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={period === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input" style={{ height: 36 }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input" style={{ height: 36 }} />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
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
          </div>

          {/* Search */}
          <div className="relative max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari produk..."
              className="input pl-9" style={{ height: 36 }} />
          </div>

          {/* Tabel */}
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
                    <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' }}>Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center" style={{ color: 'var(--text-muted)' }}>
                        Tidak ada produk terjual di periode ini.
                      </td>
                    </tr>
                  )}
                  {displayRows.map((p, i) => (
                    <tr key={p.productId || p.name} style={{ borderBottom: '1px solid var(--border-2)', background: i % 2 === 0 ? 'var(--surface)' : 'transparent' }}>
                      <td className="px-3 py-2.5 font-semibold truncate max-w-[220px]" style={{ color: 'var(--text-primary)' }}>{p.name}</td>
                      <td className="px-3 py-2.5 text-right tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyPos || '–'}</td>
                      <td className="px-3 py-2.5 text-right tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyOnline || '–'}</td>
                      <td className="px-3 py-2.5 text-right tabular" style={{ color: 'var(--text-secondary)' }}>{p.qtyConsignment || '–'}</td>
                      <td className="px-3 py-2.5 text-right font-extrabold tabular" style={{ color: 'var(--accent)' }}>{p.qtyTotal}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{formatRp(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
