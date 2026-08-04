'use client';

import { useState, useEffect } from 'react';
import {
  Loader2, RefreshCw, TrendingUp, TrendingDown, Wallet, ShoppingCart, Globe, Store,
  ScrollText, PieChart, ArrowDownCircle, ArrowUpCircle, Landmark, FileSpreadsheet,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import TopbarPortal from '@/components/TopbarPortal';
import NumberInput from '@/components/NumberInput';

const API = '';

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

const SALDO_AWAL_KEY = 'finance_report_saldo_awal';

// ─── Periode ──────────────────────────────────────────────────────────────────
type PeriodKey = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
const PERIOD_OPTIONS: { id: PeriodKey; label: string }[] = [
  { id: 'today', label: 'Hari Ini' },
  { id: '7d',    label: '7 Hari' },
  { id: '30d',   label: '30 Hari' },
  { id: 'month', label: 'Bulan Ini' },
  { id: 'year',  label: 'Tahun Ini' },
  { id: 'custom', label: 'Custom' },
];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodRange(period: PeriodKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = toISO(now);
  switch (period) {
    case 'today': return { from: today, to: today };
    case '7d': { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: toISO(d), to: today }; }
    case '30d': { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: toISO(d), to: today }; }
    case 'month': { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { from: toISO(d), to: today }; }
    case 'year': { const d = new Date(now.getFullYear(), 0, 1); return { from: toISO(d), to: today }; }
    case 'custom': return { from: customFrom || today, to: customTo || today };
  }
}

// ─── Tipe data ────────────────────────────────────────────────────────────────
interface OrderRecord {
  invoiceNo: string; customerName: string; total: number;
  source?: 'kasir' | 'portal'; status: string; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAt?: { seconds: number };
}

interface RecapRecord {
  locationName: string; totalRevenue: number; paymentStatus?: 'lunas' | 'belum_lunas';
  createdAt?: { seconds: number };
}
interface ExpenseRecord { category: string; description: string; amount: number; date: string }
interface CapitalRecord { type: 'modal' | 'prive'; amount: number; date: string; note?: string }

interface JournalEntry { seconds: number; description: string; debit: number; kredit: number; invoiceNo?: string }

const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  'Bahan Baku': '#B45309', 'Produksi': '#A84F10', 'Sewa': '#7C3AED', 'Gaji': '#0284C7',
  'Listrik & Air': '#0891B2', 'Transportasi': '#DB2777', 'Perlengkapan': '#65A30D',
};

// ─── Chart tren (mandiri, tidak menyentuh RevenueChart di page.tsx) ───────────
function TrendChart({ data }: { data: { date: string; income: number; expense: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = data.length;
  if (n === 0) return null;

  const VW = 560, VH = 150;
  const PAD = { l: 6, r: 6, t: 20, b: 26 };
  const iW = VW - PAD.l - PAD.r;
  const iH = VH - PAD.t - PAD.b;
  const maxVal = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);

  const xAt = (i: number) => PAD.l + (n === 1 ? iW / 2 : (i / (n - 1)) * iW);
  const yAt = (v: number) => PAD.t + (1 - v / maxVal) * iH;

  const linePath = (key: 'income' | 'expense') => n < 2 ? '' : data.reduce((acc, d, i) => {
    const x = xAt(i), y = yAt(d[key]);
    if (i === 0) return `M ${x},${y}`;
    const px = xAt(i - 1), py = yAt(data[i - 1][key]);
    return `${acc} C ${px + (x - px) * 0.45},${py} ${px + (x - px) * 0.55},${y} ${x},${y}`;
  }, '');

  const step = Math.max(1, Math.ceil(n / 8));
  const hd = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * VW;
          let ci = 0, md = Infinity;
          data.forEach((_, i) => { const d = Math.abs(xAt(i) - relX); if (d < md) { md = d; ci = i; } });
          setHoverIdx(ci);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {n >= 2 && <path d={linePath('income')} fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {n >= 2 && <path d={linePath('expense')} fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {n === 1 && <circle cx={xAt(0)} cy={yAt(data[0].income)} r="4" fill="#15803D" />}
        {n === 1 && <circle cx={xAt(0)} cy={yAt(data[0].expense)} r="4" fill="#DC2626" />}

        {hd && (
          <line x1={xAt(hoverIdx!)} y1={PAD.t} x2={xAt(hoverIdx!)} y2={PAD.t + iH} stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4,3" />
        )}
        {hd && <circle cx={xAt(hoverIdx!)} cy={yAt(hd.income)} r="4.5" fill="#15803D" stroke="white" strokeWidth="2" />}
        {hd && <circle cx={xAt(hoverIdx!)} cy={yAt(hd.expense)} r="4.5" fill="#DC2626" stroke="white" strokeWidth="2" />}

        {data.map((d, i) => {
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text key={i} x={xAt(i)} y={VH - 4} textAnchor="middle" fontSize="9" fill="#A08468">
              {new Date(`${d.date}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
            </text>
          );
        })}
      </svg>

      {hd && (
        <div style={{
          position: 'absolute', left: `${(xAt(hoverIdx!) / VW) * 100}%`, top: `${(Math.min(yAt(hd.income), yAt(hd.expense)) / VH) * 100}%`,
          transform: 'translate(-50%, calc(-100% - 10px))', background: 'var(--text-primary)', color: 'white',
          padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)', zIndex: 10,
        }}>
          <div style={{ color: '#4ADE80' }}>Pendapatan: {formatRp(hd.income)}</div>
          <div style={{ color: '#F87171' }}>Pengeluaran: {formatRp(hd.expense)}</div>
        </div>
      )}
    </div>
  );
}

export default function FinanceReportTab({ creds, onOpenOrder }: { creds: string; onOpenOrder?: (invoiceNo: string) => void }) {
  const headers = { 'x-admin-auth': creds };

  const [period,     setPeriod]     = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [subView,    setSubView]    = useState<'laba-rugi' | 'jurnal'>('laba-rugi');

  const [loading,  setLoading]  = useState(true);
  const [orders,   setOrders]   = useState<OrderRecord[]>([]);
  const [recaps,   setRecaps]   = useState<RecapRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [capital,  setCapital]  = useState<CapitalRecord[]>([]);
  const [exporting, setExporting] = useState(false);

  const [saldoAwalRaw, setSaldoAwalRaw] = useState('0');
  useEffect(() => {
    const saved = localStorage.getItem(SALDO_AWAL_KEY);
    if (saved) setSaldoAwalRaw(saved);
  }, []);
  const saldoAwal = parseFloat(saldoAwalRaw) || 0;

  const { from, to } = periodRange(period, customFrom, customTo);

  const load = async () => {
    setLoading(true);
    try {
      const qs = `from=${from}&to=${to}`;
      const [oRes, rRes, eRes, cRes] = await Promise.all([
        fetch(`${API}/api/orders?${qs}`, { headers }),
        fetch(`${API}/api/consignment/recap?${qs}`, { headers }),
        fetch(`${API}/api/expenses?${qs}`, { headers }),
        fetch(`${API}/api/capital?${qs}`, { headers }),
      ]);
      setOrders(oRes.ok ? (await oRes.json() as { orders: OrderRecord[] }).orders : []);
      setRecaps(rRes.ok ? (await rRes.json() as { recaps: RecapRecord[] }).recaps : []);
      setExpenses(eRes.ok ? (await eRes.json() as { expenses: ExpenseRecord[] }).expenses : []);
      setCapital(cRes.ok ? (await cRes.json() as { entries: CapitalRecord[] }).entries : []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [period, customFrom, customTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hitung Pendapatan / Beban ────────────────────────────────
  // Order/rekap "Belum Lunas" tidak ikut dihitung sebagai uang masuk sampai ditandai Lunas
  // (lihat menu Pesanan / riwayat Pembelian Bahan Baku & Rekap Konsinyasi). Field yang hilang
  // (data lama sebelum fitur ini ada) dianggap lunas.
  const countedOrders = orders.filter(o => (o.source !== 'portal' || o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
  const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');
  const kasirRevenue = countedOrders.filter(o => o.source !== 'portal').reduce((s, o) => s + (o.total ?? 0), 0);
  const onlineRevenue = countedOrders.filter(o => o.source === 'portal').reduce((s, o) => s + (o.total ?? 0), 0);
  const consignmentRevenue = countedRecaps.reduce((s, r) => s + (r.totalRevenue ?? 0), 0);
  const totalPendapatan = kasirRevenue + onlineRevenue + consignmentRevenue;

  const expenseByCategory = new Map<string, number>();
  expenses.forEach(e => expenseByCategory.set(e.category, (expenseByCategory.get(e.category) ?? 0) + e.amount));
  const totalBeban = expenses.reduce((s, e) => s + e.amount, 0);
  const labaBersih = totalPendapatan - totalBeban;

  // Modal & Prive TIDAK ikut Laba Rugi operasional — cuma info terpisah + masuk Jurnal Kas.
  const totalModalMasuk = capital.filter(c => c.type === 'modal').reduce((s, c) => s + c.amount, 0);
  const totalPrive       = capital.filter(c => c.type === 'prive').reduce((s, c) => s + c.amount, 0);

  // ── Jurnal Kas ───────────────────────────────────────────────
  const journal: JournalEntry[] = [
    ...countedOrders.map(o => ({
      seconds: o.createdAt?.seconds ?? 0,
      description: `Penjualan ${o.source === 'portal' ? 'Online' : 'Kasir'} - ${o.invoiceNo || o.customerName}`,
      debit: o.total ?? 0, kredit: 0,
      invoiceNo: o.invoiceNo || undefined,
    })),
    ...countedRecaps.map(r => ({
      seconds: r.createdAt?.seconds ?? 0,
      description: `Pendapatan Konsinyasi - ${r.locationName}`,
      debit: r.totalRevenue ?? 0, kredit: 0,
    })),
    ...expenses.map(e => ({
      seconds: new Date(`${e.date}T12:00:00`).getTime() / 1000,
      description: `${e.category} - ${e.description}`,
      debit: 0, kredit: e.amount,
    })),
    ...capital.map(c => ({
      seconds: new Date(`${c.date}T12:00:00`).getTime() / 1000,
      description: c.type === 'modal' ? `Modal Masuk${c.note ? ` - ${c.note}` : ''}` : `Prive Pemilik${c.note ? ` - ${c.note}` : ''}`,
      debit: c.type === 'modal' ? c.amount : 0, kredit: c.type === 'prive' ? c.amount : 0,
    })),
  ].sort((a, b) => a.seconds - b.seconds);

  const journalWithSaldo = journal.reduce<(JournalEntry & { saldo: number })[]>((acc, j) => {
    const prevSaldo = acc.length > 0 ? acc[acc.length - 1].saldo : saldoAwal;
    acc.push({ ...j, saldo: prevSaldo + j.debit - j.kredit });
    return acc;
  }, []);
  const journalDisplay = [...journalWithSaldo].reverse();

  // ── Chart tren harian ────────────────────────────────────────
  const dailyMap = new Map<string, { income: number; expense: number }>();
  countedOrders.forEach(o => {
    if (!o.createdAt?.seconds) return;
    const key = new Date(o.createdAt.seconds * 1000).toISOString().slice(0, 10);
    const cur = dailyMap.get(key) ?? { income: 0, expense: 0 };
    cur.income += o.total ?? 0; dailyMap.set(key, cur);
  });
  countedRecaps.forEach(r => {
    if (!r.createdAt?.seconds) return;
    const key = new Date(r.createdAt.seconds * 1000).toISOString().slice(0, 10);
    const cur = dailyMap.get(key) ?? { income: 0, expense: 0 };
    cur.income += r.totalRevenue ?? 0; dailyMap.set(key, cur);
  });
  expenses.forEach(e => {
    const cur = dailyMap.get(e.date) ?? { income: 0, expense: 0 };
    cur.expense += e.amount; dailyMap.set(e.date, cur);
  });
  const trendData = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));

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
      const styleHeader = (ws: ExcelJS.Worksheet, rowNum: number, headers: string[]) => {
        const row = ws.getRow(rowNum);
        headers.forEach((h, i) => { row.getCell(i + 1).value = h; });
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

      // ── Sheet 1: Laba Rugi ──
      const wsLR = wb.addWorksheet('Laba Rugi');
      wsLR.columns = [{ key: 'a', width: 32 }, { key: 'b', width: 20 }];
      styleTitle(wsLR, 'RINGKASAN LABA RUGI — CEMILAN TEH RISMA', `Periode: ${periodLabel} (${from} s/d ${to})`, 2);
      styleHeader(wsLR, 3, ['Keterangan', 'Jumlah']);
      const lrRows: [string, number][] = [
        ['Penjualan Kasir', kasirRevenue], ['Penjualan Online', onlineRevenue], ['Pendapatan Konsinyasi', consignmentRevenue],
        ['Total Pendapatan', totalPendapatan],
        ...[...expenseByCategory.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => [`Beban - ${c}`, v] as [string, number]),
        ['Total Beban', totalBeban],
        [labaBersih >= 0 ? 'Laba Bersih' : 'Rugi Bersih', labaBersih],
        ['Modal Masuk (di luar Laba Rugi)', totalModalMasuk], ['Prive (di luar Laba Rugi)', totalPrive],
      ];
      lrRows.forEach(([label, val], i) => {
        const rowNum = 4 + i;
        wsLR.getRow(rowNum).getCell(1).value = label;
        wsLR.getRow(rowNum).getCell(2).value = val;
        wsLR.getRow(rowNum).getCell(2).numFmt = '"Rp"#,##0';
        zebra(wsLR, rowNum, i);
      });

      // ── Sheet 2: Jurnal Kas ──
      const wsJK = wb.addWorksheet('Jurnal Kas');
      wsJK.columns = [{ key: 'tgl', width: 14 }, { key: 'ket', width: 42 }, { key: 'debit', width: 18 }, { key: 'kredit', width: 18 }, { key: 'saldo', width: 18 }];
      styleTitle(wsJK, 'JURNAL KAS — CEMILAN TEH RISMA', `Periode: ${periodLabel} (${from} s/d ${to}) · Saldo Awal: ${formatRp(saldoAwal)}`, 5);
      styleHeader(wsJK, 3, ['Tanggal', 'Keterangan', 'Debit', 'Kredit', 'Saldo']);
      journalWithSaldo.forEach((j, i) => {
        const rowNum = 4 + i;
        const row = wsJK.getRow(rowNum);
        row.getCell(1).value = j.seconds ? new Date(j.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
        row.getCell(2).value = j.description;
        row.getCell(3).value = j.debit || null;
        row.getCell(4).value = j.kredit || null;
        row.getCell(5).value = j.saldo;
        [3, 4, 5].forEach(c => { row.getCell(c).numFmt = '"Rp"#,##0'; });
        zebra(wsJK, rowNum, i);
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-keuangan-${from}-sd-${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <TopbarPortal>
        <button onClick={exportExcel} disabled={exporting || loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Export Excel">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
        </button>
        <button onClick={load} disabled={loading} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
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

      {/* Sub-view switcher */}
      <div className="inline-flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        {([
          { id: 'laba-rugi' as const, label: 'Laba Rugi', Icon: PieChart },
          { id: 'jurnal'    as const, label: 'Jurnal Kas', Icon: ScrollText },
        ]).map(t => (
          <button key={t.id} onClick={() => setSubView(t.id)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all"
            style={subView === t.id ? { background: 'var(--accent)', color: 'white' } : { color: 'var(--text-muted)' }}>
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : subView === 'laba-rugi' ? (
        <div className="space-y-5">
          {/* Ringkasan */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--success-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(21,128,61,0.15)', color: 'var(--success)' }}>
                <TrendingUp size={16} />
              </div>
              <div>
                <p className="text-lg font-extrabold tabular leading-none" style={{ color: 'var(--success)' }}>{formatRp(totalPendapatan)}</p>
                <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Total Pendapatan</p>
              </div>
            </div>
            <div className="card p-4 flex items-center gap-3" style={{ background: 'var(--danger-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.15)', color: 'var(--danger)' }}>
                <TrendingDown size={16} />
              </div>
              <div>
                <p className="text-lg font-extrabold tabular leading-none" style={{ color: 'var(--danger)' }}>{formatRp(totalBeban)}</p>
                <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Total Beban</p>
              </div>
            </div>
            <div className="card p-4 flex items-center gap-3" style={{ background: labaBersih >= 0 ? 'var(--accent-bg)' : 'var(--danger-bg)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: labaBersih >= 0 ? 'rgba(212,105,30,0.15)' : 'rgba(220,38,38,0.15)', color: labaBersih >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                <Wallet size={16} />
              </div>
              <div>
                <p className="text-lg font-extrabold tabular leading-none" style={{ color: labaBersih >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{formatRp(labaBersih)}</p>
                <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{labaBersih >= 0 ? 'Laba Bersih' : 'Rugi Bersih'}</p>
              </div>
            </div>
          </div>

          {/* Modal & Prive — di luar Laba Rugi operasional */}
          {(totalModalMasuk > 0 || totalPrive > 0) && (
            <div className="card p-4 flex items-center gap-4 flex-wrap" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-center gap-2">
                <Landmark size={15} style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Di luar Laba Rugi operasional:</span>
              </div>
              <span className="text-xs font-semibold" style={{ color: 'var(--success)' }}>Modal Masuk {formatRp(totalModalMasuk)}</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>Prive {formatRp(totalPrive)}</span>
            </div>
          )}

          {/* Chart tren */}
          {trendData.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center gap-4 mb-3">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tren Pendapatan vs Pengeluaran</p>
                <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  <span className="flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 4, background: '#15803D', display: 'inline-block' }} /> Pendapatan</span>
                  <span className="flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 4, background: '#DC2626', display: 'inline-block' }} /> Pengeluaran</span>
                </div>
              </div>
              <TrendChart data={trendData} />
            </div>
          )}

          {/* Rincian Pendapatan & Beban */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                <ArrowUpCircle size={15} style={{ color: 'var(--success)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Rincian Pendapatan</p>
              </div>
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                {[
                  { icon: <ShoppingCart size={14} />, label: 'Penjualan Kasir', val: kasirRevenue },
                  { icon: <Globe size={14} />, label: 'Penjualan Online', val: onlineRevenue },
                  { icon: <Store size={14} />, label: 'Pendapatan Konsinyasi', val: consignmentRevenue },
                ].map((r, i) => (
                  <div key={i} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{r.icon}</div>
                    <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{r.label}</span>
                    <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(r.val)}</span>
                    <span className="text-xs tabular w-10 text-right" style={{ color: 'var(--text-muted)' }}>
                      {totalPendapatan > 0 ? Math.round((r.val / totalPendapatan) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
                <ArrowDownCircle size={15} style={{ color: 'var(--danger)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Rincian Beban</p>
              </div>
              {expenseByCategory.size === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Tidak ada pengeluaran di periode ini.</p>
              ) : (
                <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                  {[...expenseByCategory.entries()].sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
                    <div key={cat} className="px-5 py-3 flex items-center gap-3">
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: EXPENSE_CATEGORY_COLORS[cat] ?? '#9CA3AF', flexShrink: 0 }} />
                      <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{cat}</span>
                      <span className="text-sm font-bold tabular" style={{ color: 'var(--danger)' }}>{formatRp(val)}</span>
                      <span className="text-xs tabular w-10 text-right" style={{ color: 'var(--text-muted)' }}>
                        {totalBeban > 0 ? Math.round((val / totalBeban) * 100) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-4 flex items-center gap-3 flex-wrap">
            <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Saldo Awal (opsional)</label>
            <NumberInput value={saldoAwalRaw}
              onChange={raw => { setSaldoAwalRaw(raw); localStorage.setItem(SALDO_AWAL_KEY, raw); }}
              style={{ width: 180, height: 36 }} placeholder="0" />
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Saldo kas nyata sebelum periode ini dimulai (disimpan di browser ini saja, bukan data akuntansi baku).
            </p>
          </div>

          {journalWithSaldo.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada transaksi di periode ini.</p>
            </div>
          ) : (
            <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
              <div className="px-4 py-2.5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-2)', background: 'var(--surface-2)' }}>
                <span className="text-[10px] font-bold uppercase tracking-wide flex-shrink-0 w-20" style={{ color: 'var(--text-muted)' }}>Tanggal</span>
                <span className="flex-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Keterangan</span>
                <span className="text-[10px] font-bold uppercase tracking-wide w-28 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Debit</span>
                <span className="text-[10px] font-bold uppercase tracking-wide w-28 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Kredit</span>
                <span className="text-[10px] font-bold uppercase tracking-wide w-28 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Saldo</span>
              </div>
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
              {journalDisplay.map((j, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <span className="text-xs tabular flex-shrink-0 w-20" style={{ color: 'var(--text-muted)' }}>
                    {j.seconds ? new Date(j.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' }) : '–'}
                  </span>
                  {j.invoiceNo ? (
                    <button type="button" onClick={() => onOpenOrder?.(j.invoiceNo!)}
                      className="flex-1 min-w-0 text-sm text-left truncate hover:underline"
                      style={{ color: 'var(--accent)' }} title="Lihat transaksi di menu Pesanan">
                      {j.description}
                    </button>
                  ) : (
                    <span className="flex-1 min-w-0 text-sm truncate" style={{ color: 'var(--text-primary)' }}>{j.description}</span>
                  )}
                  <span className="text-sm font-bold tabular w-28 text-right flex-shrink-0" style={{ color: j.debit > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                    {j.debit > 0 ? formatRp(j.debit) : '–'}
                  </span>
                  <span className="text-sm font-bold tabular w-28 text-right flex-shrink-0" style={{ color: j.kredit > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {j.kredit > 0 ? formatRp(j.kredit) : '–'}
                  </span>
                  <span className="text-sm font-bold tabular w-28 text-right flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                    {formatRp(j.saldo)}
                  </span>
                </div>
              ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
