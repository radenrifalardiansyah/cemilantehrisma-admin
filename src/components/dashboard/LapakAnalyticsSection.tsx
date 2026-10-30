'use client';

import { useState, useEffect } from 'react';
import {
  Area, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ComposedChart,
} from 'recharts';
import {
  Store, Wallet, TrendingUp, TrendingDown, Receipt, HandCoins, Boxes, Repeat, PackageX, Clock, CalendarDays, CreditCard, AlertTriangle, ShoppingBag, Users, PackageSearch,
} from 'lucide-react';
import FilterSelect from '@/components/FilterSelect';
import TopListChart from './TopListChart';
import PeriodBar from '@/components/tabs/titip-jual/PeriodBar';
import PageLoader from '@/components/PageLoader';
import AnalyticsPdfButton from './AnalyticsPdfButton';
import { pdfRp, pdfDate, pdfNow, type AnalyticsReportData } from '@/lib/pdf/AnalyticsReportPDF';
import { periodRange, type PeriodKey } from '@/lib/period';

interface LapakAnalytics {
  period: { from: string; to: string; prevFrom: string; prevTo: string; days: number };
  stallOptions: { id: string; name: string }[];
  summary: {
    revenue: number; prevRevenue: number; count: number; prevCount: number; avgTicket: number; itemsSold: number;
    consignRevenue: number; ownRevenue: number; consignorShare: number; ourConsignShare: number; storeIncome: number;
    liabilityUnsettled: number; liabilityUnpaid: number; stockQty: number; stockValue: number; sellThroughPct: number; walletTotal: number;
    deadStockCount: number; deadStockValue: number;
  };
  daily: { date: string; revenue: number; prev: number; prevDate: string }[];
  stalls: { id: string; name: string; revenue: number; count: number }[];
  topProducts: { kind: 'consign' | 'own'; productId: string; name: string; qty: number; revenue: number }[];
  consignors: { id: string; name: string; qty: number; gross: number; owed: number; ours: number }[];
  liabilities: { id: string; name: string; unsettled: number; unpaid: number; total: number }[];
  hours: { hour: number; count: number; revenue: number }[];
  weekdays: { dow: number; count: number; revenue: number }[];
  methods: { method: string; count: number; amount: number }[];
  deadStock: StockRow[]; lowStock: StockRow[]; soldOut: StockRow[];
}
interface StockRow { stallName: string; productId: string; name: string; consignorName: string; stock: number; price: number; minStock: number; sold: number; value?: number }

const todayKey = () => new Date().toLocaleDateString('en-CA');
const formatRp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
const compactRp = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}jt`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return `${n}`;
};
const shortDate = (s: string) => {
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
};
const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
// Metode bayar = kategori (identitas): tiga slot pertama palet kategorikal (lolos validasi CVD & jarak warna normal).
const METHOD_STYLE: Record<string, { label: string; color: string }> = {
  cash: { label: 'Tunai', color: '#2a78d6' }, transfer: { label: 'Transfer', color: '#eb6834' }, qris: { label: 'QRIS', color: '#1baf7a' },
};
const MUTED_BAR = '#D9CFC2';
const ACCENT = 'var(--accent)';

function DarkTip({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--text-primary)', color: 'white', padding: '10px 12px', borderRadius: 12, fontSize: 11, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.28)' }}>{children}</div>;
}
function TrendTip({ active, payload }: { active?: boolean; payload?: { payload?: LapakAnalytics['daily'][number] }[] }) {
  const d = active && payload?.[0]?.payload;
  if (!d) return null;
  return (
    <DarkTip>
      <div style={{ opacity: 0.65, marginBottom: 4, fontWeight: 700 }}>{shortDate(d.date)}</div>
      <div style={{ display: 'flex', gap: 6 }}><span style={{ opacity: 0.75 }}>Periode ini:</span><b>{formatRp(d.revenue)}</b></div>
      <div style={{ display: 'flex', gap: 6 }}><span style={{ opacity: 0.75 }}>{shortDate(d.prevDate)}:</span><b>{formatRp(d.prev)}</b></div>
    </DarkTip>
  );
}
function BucketTip({ active, payload, title }: { active?: boolean; payload?: { payload?: { label: string; count: number; revenue: number } }[]; title: string }) {
  const d = active && payload?.[0]?.payload;
  if (!d) return null;
  return (
    <DarkTip>
      <div style={{ opacity: 0.65, marginBottom: 4, fontWeight: 700 }}>{title} {d.label}</div>
      <div><b>{d.count}</b> transaksi</div>
      <div style={{ opacity: 0.8 }}>{formatRp(d.revenue)}</div>
    </DarkTip>
  );
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev <= 0) return <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{cur > 0 ? 'Belum ada pembanding' : '—'}</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
      <Icon size={12} /> {up ? '+' : ''}{pct}% <span className="font-medium" style={{ color: 'var(--text-muted)' }}>vs periode sebelumnya</span>
    </span>
  );
}

function Tile({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-muted)' }}>
        <span style={{ color: tone ?? 'var(--accent)' }}>{icon}</span>
        <p className="text-[10px] font-bold uppercase tracking-wide leading-tight">{label}</p>
      </div>
      <p className="tabular font-extrabold leading-tight break-words" style={{ fontSize: 20, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{value}</p>
      {sub && <div className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function Panel({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color: 'var(--accent)' }}>{icon}</span>
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</p>
      </div>
      {hint && <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-xs text-center py-5" style={{ color: 'var(--text-muted)' }}>{text}</p>;

function StockList({ rows, empty, sub }: { rows: StockRow[]; empty: string; sub: (r: StockRow) => string }) {
  if (rows.length === 0) return <Empty text={empty} />;
  return (
    <div>
      {rows.map((r, i) => (
        <div key={`${r.productId}-${r.stallName}`} className="flex items-center gap-3 py-2.5" style={{ borderTop: i > 0 ? '1px solid var(--border-2)' : undefined }}>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{r.name}</p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{r.stallName} · {r.consignorName}</p>
          </div>
          <p className="text-xs font-bold tabular text-right flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{sub(r)}</p>
        </div>
      ))}
    </div>
  );
}

// Dashboard → Analitik Lapak: gambaran performa Titip Jual & lapak (terpisah dari analitik toko). Tidak mengubah data.
export default function LapakAnalyticsSection({ creds }: { creds: string }) {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const [stallId, setStallId] = useState('');
  const [data, setData] = useState<LapakAnalytics | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading');
  const { from, to } = periodRange(period, customFrom, customTo);

  useEffect(() => {
    let alive = true;
    fetch(`/api/analytics/lapak?from=${from}&to=${to}&stallId=${stallId}`, { headers: { 'x-admin-auth': creds } })
      .then(async r => {
        if (!alive) return;
        if (r.status === 403) { setState('denied'); return; }
        if (!r.ok) { setState('error'); return; }
        setData(await r.json() as LapakAnalytics); setState('ok');
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [creds, from, to, stallId]);

  const header = (
    <div className="flex items-center justify-between gap-2.5 pt-2 flex-wrap">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}><Store size={16} /></div>
        <div>
          <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Analitik Lapak</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Titip Jual &amp; lapak — penjualan, penitip, dan kesehatan stok (terpisah dari toko)</p>
        </div>
      </div>
    </div>
  );

  if (state === 'denied') return <div className="space-y-5">{header}<Empty text="Anda tidak punya akses ke analitik lapak (butuh izin Titip Jual atau Laporan Penjualan Lapak)." /></div>;
  if (state === 'error' && !data) return <div className="space-y-5">{header}<Empty text="Gagal memuat analitik lapak." /></div>;
  if (!data) return <div className="space-y-5">{header}<PageLoader compact /></div>;

  const s = data.summary;
  const hasSales = s.count > 0;
  const peakHour = [...data.hours].sort((a, b) => b.count - a.count)[0];
  const peakDow = [...data.weekdays].sort((a, b) => b.count - a.count)[0];
  const methodTotal = data.methods.reduce((a, m) => a + m.amount, 0);
  const hourData = data.hours.map(h => ({ ...h, label: `${String(h.hour).padStart(2, '0')}.00` }));
  const dowData = data.weekdays.map(w => ({ ...w, label: DOW[w.dow - 1] }));
  const peakHourLabel = peakHour && peakHour.count > 0 ? `${String(peakHour.hour).padStart(2, '0')}.00–${String((peakHour.hour + 1) % 24).padStart(2, '0')}.00` : '';

  const stallLabel = data.stallOptions.find(o => o.id === stallId)?.name;
  const buildPdf = (): AnalyticsReportData => {
    const stockCols = [
      { header: 'No', width: '6%', align: 'center' as const }, { header: 'Produk', width: '30%', bold: true }, { header: 'Lapak', width: '20%' },
      { header: 'Penitip', width: '20%' }, { header: 'Stok', width: '9%', align: 'right' as const }, { header: 'Terjual', width: '15%', align: 'right' as const },
    ];
    const stockRows = (list: StockRow[]) => list.map((r, i) => [i + 1, r.name, r.stallName, r.consignorName, r.stock, r.sold]);
    return {
      title: 'ANALITIK LAPAK',
      periodLabel: `${pdfDate(from)} - ${pdfDate(to)}${stallLabel ? ` (${stallLabel})` : ' (Semua lapak)'}`,
      generatedAt: pdfNow(),
      cards: [
        { label: 'Omzet', value: pdfRp(s.revenue) }, { label: 'Transaksi', value: String(s.count) },
        { label: 'Rata-rata / Transaksi', value: pdfRp(s.avgTicket) }, { label: 'Barang Terjual', value: String(s.itemsSold) },
        { label: 'Pendapatan Toko', value: pdfRp(s.storeIncome) }, { label: 'Bagian Penitip', value: pdfRp(s.consignorShare) },
        { label: 'Hutang ke Penitip (Belum Dibayar)', value: pdfRp(s.liabilityUnpaid) }, { label: 'Nilai Stok', value: pdfRp(s.stockValue) },
        { label: 'Tingkat Terjual', value: `${s.sellThroughPct}%` }, { label: 'Saldo Dompet Lapak', value: pdfRp(s.walletTotal) },
        { label: 'Omzet Periode Sebelumnya', value: pdfRp(s.prevRevenue) }, { label: 'Stok Mati', value: `${s.deadStockCount} item / ${pdfRp(s.deadStockValue)}` },
      ],
      charts: [
        {
          title: 'Tren Omzet Harian', type: 'line', labels: data.daily.map(d => shortDate(d.date)),
          series: [
            { name: 'Periode ini', color: '#D4691E', values: data.daily.map(d => d.revenue) },
            { name: 'Periode sebelumnya', color: '#A08468', values: data.daily.map(d => d.prev) },
          ],
        },
        {
          title: 'Omzet per Lapak', type: 'bar', labels: data.stalls.slice(0, 8).map(x => x.name),
          series: [{ name: 'Omzet', color: '#D4691E', values: data.stalls.slice(0, 8).map(x => x.revenue) }],
        },
        {
          title: 'Produk Terlaris', type: 'bar', labels: data.topProducts.slice(0, 8).map(p => p.name),
          series: [{ name: 'Omzet', color: '#7C3AED', values: data.topProducts.slice(0, 8).map(p => p.revenue) }],
        },
        {
          title: 'Transaksi per Jam', type: 'line', unit: 'num', labels: data.hours.map(h => String(h.hour).padStart(2, '0')),
          series: [{ name: 'Transaksi', color: '#0284C7', values: data.hours.map(h => h.count) }],
        },
      ],
      sections: [
        {
          title: 'Omzet per Lapak', emptyText: 'Belum ada penjualan di periode ini.',
          columns: [{ header: 'No', width: '8%', align: 'center' }, { header: 'Lapak', width: '42%', bold: true }, { header: 'Transaksi', width: '20%', align: 'right' }, { header: 'Omzet', width: '30%', align: 'right', bold: true }],
          rows: data.stalls.map((x, i) => [i + 1, x.name, x.count, pdfRp(x.revenue)]),
          total: ['', 'Total', data.stalls.reduce((a, x) => a + x.count, 0), pdfRp(data.stalls.reduce((a, x) => a + x.revenue, 0))],
        },
        {
          title: 'Produk Terlaris', emptyText: 'Belum ada produk terjual.',
          columns: [{ header: 'No', width: '7%', align: 'center' }, { header: 'Produk', width: '43%', bold: true }, { header: 'Jenis', width: '15%' }, { header: 'Qty', width: '12%', align: 'right' }, { header: 'Omzet', width: '23%', align: 'right', bold: true }],
          rows: data.topProducts.map((p, i) => [i + 1, p.name, p.kind === 'own' ? 'Produk toko' : 'Titipan', p.qty, pdfRp(p.revenue)]),
          total: ['', 'Total', '', data.topProducts.reduce((a, p) => a + p.qty, 0), pdfRp(data.topProducts.reduce((a, p) => a + p.revenue, 0))],
        },
        {
          title: 'Penitip', emptyText: 'Belum ada penjualan titipan.',
          columns: [{ header: 'No', width: '7%', align: 'center' }, { header: 'Penitip', width: '31%', bold: true }, { header: 'Qty', width: '10%', align: 'right' }, { header: 'Penjualan Kotor', width: '20%', align: 'right' }, { header: 'Bagian Penitip', width: '16%', align: 'right' }, { header: 'Bagian Toko', width: '16%', align: 'right' }],
          rows: data.consignors.map((c, i) => [i + 1, c.name, c.qty, pdfRp(c.gross), pdfRp(c.owed), pdfRp(c.ours)]),
          total: ['', 'Total', data.consignors.reduce((a, c) => a + c.qty, 0), pdfRp(data.consignors.reduce((a, c) => a + c.gross, 0)), pdfRp(data.consignors.reduce((a, c) => a + c.owed, 0)), pdfRp(data.consignors.reduce((a, c) => a + c.ours, 0))],
        },
        {
          title: 'Hutang ke Penitip', emptyText: 'Tidak ada hutang ke penitip.',
          columns: [{ header: 'No', width: '8%', align: 'center' }, { header: 'Penitip', width: '32%', bold: true }, { header: 'Belum Disettle', width: '20%', align: 'right' }, { header: 'Belum Dibayar', width: '20%', align: 'right' }, { header: 'Total', width: '20%', align: 'right', bold: true }],
          rows: data.liabilities.map((l, i) => [i + 1, l.name, pdfRp(l.unsettled), pdfRp(l.unpaid), pdfRp(l.total)]),
          total: ['', 'Total', pdfRp(data.liabilities.reduce((a, l) => a + l.unsettled, 0)), pdfRp(data.liabilities.reduce((a, l) => a + l.unpaid, 0)), pdfRp(data.liabilities.reduce((a, l) => a + l.total, 0))],
        },
        {
          title: 'Metode Pembayaran', emptyText: 'Belum ada transaksi.',
          columns: [{ header: 'Metode', width: '40%', bold: true }, { header: 'Transaksi', width: '25%', align: 'right' }, { header: 'Jumlah', width: '35%', align: 'right', bold: true }],
          rows: data.methods.map(m => [METHOD_STYLE[m.method]?.label ?? m.method, m.count, pdfRp(m.amount)]),
          total: ['Total', data.methods.reduce((a, m) => a + m.count, 0), pdfRp(methodTotal)],
        },
        {
          title: 'Tren Omzet Harian', emptyText: 'Belum ada data.',
          columns: [{ header: 'Tanggal', width: '30%' }, { header: 'Periode Ini', width: '35%', align: 'right', bold: true }, { header: 'Periode Sebelumnya', width: '35%', align: 'right' }],
          rows: data.daily.map(d => [pdfDate(d.date), pdfRp(d.revenue), pdfRp(d.prev)]),
          total: ['Total', pdfRp(data.daily.reduce((a, d) => a + d.revenue, 0)), pdfRp(data.daily.reduce((a, d) => a + d.prev, 0))],
        },
        { title: 'Stok Mati (Tidak Laku)', columns: stockCols, rows: stockRows(data.deadStock), emptyText: 'Tidak ada stok mati.' },
        { title: 'Stok Menipis', columns: stockCols, rows: stockRows(data.lowStock), emptyText: 'Tidak ada stok menipis.' },
        { title: 'Stok Habis', columns: stockCols, rows: stockRows(data.soldOut), emptyText: 'Tidak ada stok habis.' },
      ],
    };
  };

  return (
    <div className="space-y-5">
      {header}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1 min-w-0"><PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} /></div>
        <div className="lg:w-56">
          <FilterSelect value={stallId} onChange={setStallId} searchPlaceholder="Cari lapak…"
            options={[{ value: '', label: 'Semua lapak' }, ...data.stallOptions.map(o => ({ value: o.id, label: o.name }))]} />
        </div>
        <AnalyticsPdfButton creds={creds} build={buildPdf} disabled={state === 'loading'}
          filename={`analitik-lapak-${from}_${to}.pdf`} />
      </div>

      <div style={{ opacity: state === 'loading' ? 0.6 : 1, transition: 'opacity 0.15s' }} className="space-y-5">
        {/* Angka utama */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile icon={<Wallet size={15} />} label="Omzet Lapak" value={formatRp(s.revenue)} sub={<Delta cur={s.revenue} prev={s.prevRevenue} />} />
          <Tile icon={<Receipt size={15} />} label="Transaksi" value={s.count.toLocaleString('id-ID')} sub={<><Delta cur={s.count} prev={s.prevCount} /><br />Rata-rata {formatRp(s.avgTicket)} · {s.itemsSold.toLocaleString('id-ID')} item</>} />
          <Tile icon={<ShoppingBag size={15} />} label="Pendapatan Toko dari Lapak" value={formatRp(s.storeIncome)} sub={`Bagian toko titipan ${formatRp(s.ourConsignShare)} + produk toko ${formatRp(s.ownRevenue)}`} tone="var(--success)" />
          <Tile icon={<HandCoins size={15} />} label="Hak Penitip Belum Dibayar" value={formatRp(s.liabilityUnsettled + s.liabilityUnpaid)} sub={`Belum direkap ${formatRp(s.liabilityUnsettled)} · rekap belum bayar ${formatRp(s.liabilityUnpaid)}`} tone="var(--danger)" />
          <Tile icon={<Boxes size={15} />} label="Nilai Stok Titipan" value={formatRp(s.stockValue)} sub={`${s.stockQty.toLocaleString('id-ID')} stok di lapak`} />
          <Tile icon={<Repeat size={15} />} label="Perputaran Stok" value={`${s.sellThroughPct}%`} sub="Terjual dibanding (terjual + stok sisa) pada periode ini" />
          <Tile icon={<PackageX size={15} />} label="Stok Mengendap" value={s.deadStockCount.toLocaleString('id-ID')} sub={`${formatRp(s.deadStockValue)} · stok ada, tak ada penjualan di periode ini`} tone={s.deadStockCount > 0 ? 'var(--danger)' : 'var(--accent)'} />
          <Tile icon={<Wallet size={15} />} label="Saldo Dompet Lapak" value={formatRp(s.walletTotal)} sub="Saat ini (di luar periode)" />
        </div>

        {/* Tren */}
        <Panel icon={<TrendingUp size={15} />} title="Tren Omzet Harian" hint="Garis putus-putus = periode sebelumnya dengan panjang sama">
          {!hasSales && s.prevRevenue <= 0 ? <Empty text="Belum ada penjualan lapak di periode ini." /> : (
            <>
              <div className="flex items-center gap-4 text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                <span className="flex items-center gap-1.5"><span style={{ width: 14, height: 3, borderRadius: 2, background: ACCENT, display: 'inline-block' }} /> Periode ini</span>
                <span className="flex items-center gap-1.5"><span style={{ width: 14, height: 0, borderTop: '2px dashed #A08468', display: 'inline-block' }} /> Periode sebelumnya</span>
              </div>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="lapakFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#D4691E" stopOpacity={0.22} /><stop offset="100%" stopColor="#D4691E" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid vertical={false} stroke="var(--border-2)" />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} minTickGap={28} tickMargin={8} />
                    <YAxis tickFormatter={compactRp} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={48} tickCount={5} />
                    <Tooltip content={<TrendTip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="revenue" name="Periode ini" stroke="#D4691E" fill="url(#lapakFill)" strokeWidth={3} dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#D4691E' }} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
                    <Line type="monotone" dataKey="prev" name="Periode sebelumnya" stroke="#A08468" strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <details className="mt-3">
                <summary className="text-xs font-semibold cursor-pointer" style={{ color: 'var(--accent)' }}>Lihat sebagai tabel</summary>
                <div className="mt-2 max-h-56 overflow-y-auto thin-scrollbar">
                  <table className="w-full text-xs tabular">
                    <thead><tr style={{ color: 'var(--text-muted)' }}><th className="text-left py-1">Tanggal</th><th className="text-right">Periode ini</th><th className="text-right">Periode sebelumnya</th></tr></thead>
                    <tbody>{data.daily.map(d => <tr key={d.date} style={{ borderTop: '1px solid var(--border-2)' }}><td className="py-1">{shortDate(d.date)}</td><td className="text-right">{formatRp(d.revenue)}</td><td className="text-right" style={{ color: 'var(--text-muted)' }}>{formatRp(d.prev)}</td></tr>)}</tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Panel>

        {/* Peringkat — panel terakhir melebar penuh kalau jumlahnya ganjil, supaya tidak ada ruang kosong di kanan */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:[&>:last-child:nth-child(odd)]:col-span-2">
          {!stallId && data.stalls.length > 1 && (
            <Panel icon={<Store size={15} />} title="Omzet per Lapak" hint="Perbandingan lapak pada periode ini">
              <TopListChart color={ACCENT} formatValue={formatRp} items={data.stalls.slice(0, 8).map(x => ({ label: x.name, value: x.revenue, sub: `· ${x.count} transaksi` }))} />
            </Panel>
          )}
          <Panel icon={<ShoppingBag size={15} />} title="Produk Terlaris" hint="Berdasarkan pendapatan (setelah retur)">
            {data.topProducts.length === 0 ? <Empty text="Belum ada produk terjual." /> : (
              <TopListChart color={ACCENT} formatValue={formatRp} items={data.topProducts.map(p => ({ label: p.name, value: p.revenue, sub: `· ${p.qty.toLocaleString('id-ID')} pcs${p.kind === 'consign' ? ' · titipan' : ''}` }))} />
            )}
          </Panel>
          <Panel icon={<Users size={15} />} title="Penitip Teratas" hint="Nilai penjualan barang titipan">
            {data.consignors.length === 0 ? <Empty text="Belum ada penjualan titipan." /> : (
              <TopListChart color={ACCENT} formatValue={formatRp} items={data.consignors.map(c => ({ label: c.name, value: c.gross, sub: `· hak ${formatRp(c.owed)}` }))} />
            )}
          </Panel>
          <Panel icon={<HandCoins size={15} />} title="Hak Penitip yang Belum Dibayar" hint="Belum direkap + rekap yang belum dibayar (kondisi saat ini)">
            {data.liabilities.length === 0 ? <Empty text="Tidak ada kewajiban ke penitip." /> : (
              <TopListChart color="#A8531A" formatValue={formatRp} items={data.liabilities.map(l => ({ label: l.name, value: l.total, sub: `· belum rekap ${formatRp(l.unsettled)}` }))} />
            )}
          </Panel>
        </div>

        {/* Pola waktu */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Panel icon={<Clock size={15} />} title="Jam Ramai" hint={peakHourLabel ? `Tersibuk ${peakHourLabel} · ${peakHour.count} transaksi (WIB)` : 'Jumlah transaksi per jam (WIB)'}>
            {!hasSales ? <Empty text="Belum ada transaksi." /> : (
              <div style={{ width: '100%', height: 190 }}>
                <ResponsiveContainer>
                  <BarChart data={hourData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap={3}>
                    <CartesianGrid vertical={false} stroke="var(--border-2)" />
                    <XAxis dataKey="hour" tickFormatter={h => (h % 3 === 0 ? String(h) : '')} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={34} tickCount={4} />
                    <Tooltip content={<BucketTip title="Pukul" />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={18}>
                      {hourData.map(h => <Cell key={h.hour} fill={h.hour === peakHour.hour && h.count > 0 ? ACCENT : MUTED_BAR} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
          <Panel icon={<CalendarDays size={15} />} title="Hari Ramai" hint={peakDow && peakDow.count > 0 ? `Tersibuk hari ${DOW[peakDow.dow - 1]} · ${peakDow.count} transaksi` : 'Jumlah transaksi per hari dalam seminggu'}>
            {!hasSales ? <Empty text="Belum ada transaksi." /> : (
              <div style={{ width: '100%', height: 190 }}>
                <ResponsiveContainer>
                  <BarChart data={dowData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap={10}>
                    <CartesianGrid vertical={false} stroke="var(--border-2)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={34} tickCount={4} />
                    <Tooltip content={<BucketTip title="Hari" />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={36}>
                      {dowData.map(w => <Cell key={w.dow} fill={w.dow === peakDow.dow && w.count > 0 ? ACCENT : MUTED_BAR} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>

        {/* Metode bayar */}
        <Panel icon={<CreditCard size={15} />} title="Metode Pembayaran" hint="Porsi omzet per metode">
          {methodTotal <= 0 ? <Empty text="Belum ada transaksi." /> : (
            <>
              <div className="flex w-full overflow-hidden rounded-full" style={{ height: 14, gap: 2, background: 'var(--surface)' }} role="img"
                aria-label={data.methods.map(m => `${METHOD_STYLE[m.method]?.label ?? m.method} ${Math.round((m.amount / methodTotal) * 100)}%`).join(', ')}>
                {data.methods.map(m => <div key={m.method} style={{ width: `${(m.amount / methodTotal) * 100}%`, background: METHOD_STYLE[m.method]?.color ?? '#888' }} />)}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
                {data.methods.map(m => (
                  <div key={m.method} className="flex items-center gap-2 text-xs">
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: METHOD_STYLE[m.method]?.color ?? '#888', display: 'inline-block' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{METHOD_STYLE[m.method]?.label ?? m.method}</span>
                    <b className="tabular" style={{ color: 'var(--text-primary)' }}>{Math.round((m.amount / methodTotal) * 100)}%</b>
                    <span className="tabular" style={{ color: 'var(--text-muted)' }}>{formatRp(m.amount)} · {m.count} transaksi</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        {/* Kesehatan stok */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Panel icon={<AlertTriangle size={15} />} title="Stok Menipis" hint="Sudah di batas minimum — saatnya minta penitip menambah">
            <StockList rows={data.lowStock} empty="Tidak ada stok yang menipis." sub={r => `${r.stock} / min ${r.minStock}`} />
          </Panel>
          <Panel icon={<PackageSearch size={15} />} title="Habis Terjual" hint="Stok 0 padahal laku di periode ini">
            <StockList rows={data.soldOut} empty="Tidak ada yang habis." sub={r => `terjual ${r.sold}`} />
          </Panel>
          <Panel icon={<PackageX size={15} />} title="Stok Mengendap" hint="Ada stok tapi tak terjual di periode ini — pertimbangkan retur ke penitip">
            <StockList rows={data.deadStock} empty="Semua stok bergerak." sub={r => `${r.stock} · ${formatRp(r.value ?? r.stock * r.price)}`} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
