'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { CalendarRange, Trophy, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import PageLoader from '@/components/PageLoader';
import AnalyticsPdfButton from './AnalyticsPdfButton';
import { pdfRp, pdfNow, type AnalyticsReportData } from '@/lib/pdf/AnalyticsReportPDF';

interface MonthRow {
  month: string; // yyyy-mm
  pendapatan: number; hpp: number; labaKotor: number; bebanOperasional: number; selisihStok: number; labaBersih: number;
  online: number; pos: number; consignment: number; incomeLain: number;
}

const METRICS = [
  { key: 'pendapatan', label: 'Penjualan (Pendapatan)', color: '#0284C7' },
  { key: 'labaKotor', label: 'Laba Kotor', color: '#D4691E' },
  { key: 'labaBersih', label: 'Laba Bersih', color: '#059669' },
] as const;
type MetricKey = typeof METRICS[number]['key'];

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
function compactRp(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}jt`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return `${n}`;
}
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const shortMonth = (m: string) => `${MONTHS_ID[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const fullMonth = (m: string) => `${MONTHS_FULL[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const lastDayOf = (m: string) => String(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()).padStart(2, '0');

function MonthTooltip({ active, payload, label }: {
  active?: boolean; label?: string; payload?: { name?: string; value?: number; color?: string }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background: 'var(--text-primary)', color: 'white', padding: '10px 12px', borderRadius: 12, fontSize: 11, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.28)' }}>
      {label && <div style={{ opacity: 0.65, marginBottom: 4, fontWeight: 700 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ opacity: 0.75 }}>{p.name}:</span>
          <span style={{ fontWeight: 800 }}>{formatRp(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

// Dashboard → Analitik Bisnis: penjualan & laba per bulan (satu tahun atau rentang bulan bebas),
// supaya kelihatan bulan mana yang tertinggi. Berdiri sendiri — tidak ikut filter periode di atasnya.
export default function MonthlyFinanceSection({ creds }: { creds: string }) {
  const thisYear = new Date().getFullYear();
  const thisMonth = `${thisYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [mode, setMode] = useState<'year' | 'custom'>('year');
  const [year, setYear] = useState(thisYear);
  const [fromM, setFromM] = useState(`${thisYear}-01`);
  const [toM, setToM] = useState(thisMonth);
  const [metrics, setMetrics] = useState<Set<MetricKey>>(new Set<MetricKey>(['pendapatan', 'labaBersih']));
  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  const range = useMemo(() => {
    if (mode === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
    return { from: `${fromM}-01`, to: `${toM}-${lastDayOf(toM)}` };
  }, [mode, year, fromM, toM]);
  const validRange = /^\d{4}-\d{2}$/.test(fromM) && /^\d{4}-\d{2}$/.test(toM) && fromM <= toM;

  useEffect(() => {
    if (mode === 'custom' && !validRange) return;
    let alive = true;
    fetch(`/api/analytics/monthly?from=${range.from}&to=${range.to}`, { headers: { 'x-admin-auth': creds } })
      .then(async r => {
        if (!alive) return;
        const d = await r.json().catch(() => ({})) as { months?: MonthRow[]; error?: string };
        if (!r.ok || !d.months) { setErrMsg(d.error ?? 'Gagal memuat data bulanan.'); setState('error'); return; }
        setRows(d.months); setState('ok');
      })
      .catch(() => { if (alive) { setErrMsg('Gagal memuat data bulanan.'); setState('error'); } });
    return () => { alive = false; };
  }, [creds, range.from, range.to, mode, validRange]);

  const toggleMetric = (k: MetricKey) => setMetrics(prev => {
    const next = new Set(prev);
    if (next.has(k)) { if (next.size > 1) next.delete(k); } else next.add(k);
    return next;
  });
  const startLoading = () => setState('loading');

  const active = METRICS.filter(m => metrics.has(m.key));
  const chartData = (rows ?? []).map(r => ({ ...r, label: shortMonth(r.month) }));
  const hasActivity = (rows ?? []).some(r => r.pendapatan !== 0 || r.labaBersih !== 0);
  const best = (key: MetricKey, dir: 'max' | 'min' = 'max') => {
    const list = (rows ?? []).filter(r => r.pendapatan !== 0 || r.labaBersih !== 0);
    if (list.length === 0) return null;
    return list.reduce((a, b) => (dir === 'max' ? (b[key] > a[key] ? b : a) : (b[key] < a[key] ? b : a)));
  };
  const bestSales = best('pendapatan'), bestProfit = best('labaBersih'), worstSales = best('pendapatan', 'min');
  const total = (key: MetricKey) => (rows ?? []).reduce((a, r) => a + r[key], 0);
  const avgSales = rows && rows.length > 0 ? total('pendapatan') / rows.length : 0;
  const maxOf = (key: MetricKey) => Math.max(...(rows ?? []).map(r => r[key]));

  const periodLabel = rows && rows.length > 0 ? `${fullMonth(rows[0].month)} - ${fullMonth(rows[rows.length - 1].month)}` : '';
  const buildPdf = (): AnalyticsReportData | null => {
    if (!rows || rows.length === 0) return null;
    const labels = rows.map(r => shortMonth(r.month));
    return {
      title: 'PENJUALAN & LABA',
      periodLabel: `Per Bulan, ${periodLabel}`, generatedAt: pdfNow(),
      cards: [
        { label: 'Total Penjualan', value: pdfRp(total('pendapatan')) },
        { label: 'Total Laba Kotor', value: pdfRp(total('labaKotor')) },
        { label: 'Total Laba Bersih', value: pdfRp(total('labaBersih')) },
        { label: 'Rata-rata Penjualan / Bulan', value: pdfRp(avgSales) },
        ...(bestSales ? [{ label: 'Bulan Penjualan Tertinggi', value: `${fullMonth(bestSales.month)} - ${pdfRp(bestSales.pendapatan)}` }] : []),
        ...(bestProfit ? [{ label: 'Bulan Laba Bersih Tertinggi', value: `${fullMonth(bestProfit.month)} - ${pdfRp(bestProfit.labaBersih)}` }] : []),
        ...(worstSales ? [{ label: 'Bulan Penjualan Terendah', value: `${fullMonth(worstSales.month)} - ${pdfRp(worstSales.pendapatan)}` }] : []),
      ],
      charts: [
        // Sama dengan grafik di layar: bar berkelompok per bulan untuk metrik yang sedang dipilih.
        { title: `${active.map(m => m.label).join(' vs ')} per Bulan`, type: 'vbar', labels,
          series: active.map(m => ({ name: m.label, color: m.color, values: rows.map(r => r[m.key]) })) },
      ],
      sections: [{
        title: 'Rincian per Bulan (baris kuning = bulan terbaik)',
        columns: [
          { header: 'Bulan', width: '22%', bold: true }, { header: 'Penjualan', width: '15%', align: 'right', bold: true }, { header: 'HPP', width: '12%', align: 'right' },
          { header: 'Laba Kotor', width: '13%', align: 'right' }, { header: 'Beban Ops.', width: '13%', align: 'right' }, { header: 'Selisih Stok', width: '11%', align: 'right' }, { header: 'Laba Bersih', width: '14%', align: 'right', bold: true },
        ],
        rows: rows.map(r => {
          const tags = [bestSales?.month === r.month ? 'Penjualan tertinggi' : '', bestProfit?.month === r.month ? 'Laba bersih tertinggi' : ''].filter(Boolean);
          return [`${fullMonth(r.month).replace(/ \d{4}$/, ` ${r.month.slice(2, 4)}`)}${tags.length ? `\n* ${tags.join(' + ')}` : ''}`, pdfRp(r.pendapatan), pdfRp(r.hpp), pdfRp(r.labaKotor), pdfRp(r.bebanOperasional), pdfRp(r.selisihStok), pdfRp(r.labaBersih)];
        }),
        highlightRows: rows.map((r, i) => (bestSales?.month === r.month || bestProfit?.month === r.month ? i : -1)).filter(i => i >= 0),
        total: ['Total', pdfRp(total('pendapatan')), pdfRp(rows.reduce((a, r) => a + r.hpp, 0)), pdfRp(total('labaKotor')), pdfRp(rows.reduce((a, r) => a + r.bebanOperasional, 0)), pdfRp(rows.reduce((a, r) => a + r.selisihStok, 0)), pdfRp(total('labaBersih'))],
      }],
    };
  };

  const chip = (selected: boolean) => selected
    ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' }
    : { background: 'var(--surface-2)', color: 'var(--text-muted)' };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2.5 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            <CalendarRange size={16} />
          </div>
          <div>
            <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Penjualan &amp; Laba per Bulan</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Lihat bulan dengan penjualan dan keuntungan tertinggi (bar yang paling pekat)</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => { if (mode === 'year') return; startLoading(); setMode('year'); }} className="px-3 py-1.5 rounded-xl text-xs font-bold" style={chip(mode === 'year')}>Per Tahun</button>
          <button onClick={() => { if (mode === 'custom') return; startLoading(); setMode('custom'); }} className="px-3 py-1.5 rounded-xl text-xs font-bold" style={chip(mode === 'custom')}>Pilih Bulan</button>
          <AnalyticsPdfButton creds={creds} build={buildPdf} disabled={state !== 'ok' || !hasActivity}
            filename={`penjualan-laba-bulanan-${range.from.slice(0, 7)}_${range.to.slice(0, 7)}.pdf`} />
        </div>
      </div>

      {mode === 'year' ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {Array.from({ length: 5 }, (_, i) => thisYear - i).map(y => (
            <button key={y} onClick={() => { if (y === year) return; startLoading(); setYear(y); }} className="px-3 py-1.5 rounded-xl text-xs font-bold" style={chip(year === y)}>{y}</button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <input type="month" value={fromM} max={toM || undefined} onChange={e => { startLoading(); setFromM(e.target.value); }} className="input" style={{ height: 36 }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
          <input type="month" value={toM} min={fromM || undefined} onChange={e => { startLoading(); setToM(e.target.value); }} className="input" style={{ height: 36 }} />
          {!validRange && <span className="text-xs" style={{ color: 'var(--danger)' }}>Pilih bulan awal dan akhir yang valid.</span>}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {METRICS.map(m => (
          <button key={m.key} onClick={() => toggleMetric(m.key)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={metrics.has(m.key) ? { background: 'var(--surface-2)', color: 'var(--text-primary)', boxShadow: `inset 0 0 0 2px ${m.color}` } : { background: 'var(--surface-2)', color: 'var(--text-muted)', opacity: 0.7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: m.color, display: 'inline-block' }} />{m.label}
          </button>
        ))}
      </div>

      {state === 'loading' && (mode === 'year' || validRange) && <PageLoader compact />}
      {state === 'error' && <p className="text-xs text-center py-8" style={{ color: 'var(--danger)' }}>{errMsg}</p>}

      {state === 'ok' && rows && (
        !hasActivity ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada transaksi di periode ini.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { icon: <Trophy size={15} />, label: 'Penjualan Tertinggi', main: bestSales ? fullMonth(bestSales.month) : '-', sub: bestSales ? formatRp(bestSales.pendapatan) : '', color: '#0284C7' },
                { icon: <TrendingUp size={15} />, label: 'Laba Bersih Tertinggi', main: bestProfit ? fullMonth(bestProfit.month) : '-', sub: bestProfit ? formatRp(bestProfit.labaBersih) : '', color: '#059669' },
                { icon: <TrendingDown size={15} />, label: 'Penjualan Terendah', main: worstSales ? fullMonth(worstSales.month) : '-', sub: worstSales ? formatRp(worstSales.pendapatan) : '', color: '#DC2626' },
                { icon: <Wallet size={15} />, label: 'Rata-rata Penjualan / Bulan', main: formatRp(avgSales), sub: `Total ${formatRp(total('pendapatan'))}`, color: 'var(--accent)' },
              ].map((c, i) => (
                <div key={i} className="rounded-2xl p-3.5" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-1.5 mb-1.5" style={{ color: c.color }}>
                    {c.icon}<p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                  </div>
                  <p className="text-sm font-extrabold tabular leading-tight" style={{ color: 'var(--text-primary)' }}>{c.main}</p>
                  <p className="text-[11px] tabular mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.sub}</p>
                </div>
              ))}
            </div>

            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barGap={3} barCategoryGap="18%">
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickMargin={8} interval={0} />
                  <YAxis tickFormatter={compactRp} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={48} tickCount={6} />
                  <Tooltip content={<MonthTooltip />} cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  {active.map(m => (
                    <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} radius={[4, 4, 0, 0]} maxBarSize={28}>
                      {chartData.map((d, i) => (
                        // Bulan tertinggi untuk metrik ini dipekatkan, lainnya diredupkan.
                        <Cell key={i} fill={m.color} fillOpacity={d[m.key] === maxOf(m.key) && d[m.key] > 0 ? 1 : 0.5} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
              <table className="w-full text-xs tabular" style={{ minWidth: 560 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    {['Bulan', 'Penjualan', 'HPP', 'Laba Kotor', 'Beban Ops.', 'Laba Bersih'].map((h, i) => (
                      <th key={h} className="px-3 py-2 font-bold uppercase text-[10px] tracking-wide" style={{ textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.month} style={{ borderTop: '1px solid var(--border-2)' }}>
                      <td className="px-3 py-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {fullMonth(r.month)}
                        {bestSales?.month === r.month && <span className="ml-1.5" title="Penjualan tertinggi">🏆</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: 'var(--text-primary)' }}>{formatRp(r.pendapatan)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{formatRp(r.hpp)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{formatRp(r.labaKotor)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{formatRp(r.bebanOperasional)}</td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: r.labaBersih >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatRp(r.labaBersih)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                    <td className="px-3 py-2 font-extrabold" style={{ color: 'var(--text-primary)' }}>Total</td>
                    <td className="px-3 py-2 text-right font-extrabold" style={{ color: 'var(--text-primary)' }}>{formatRp(total('pendapatan'))}</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: 'var(--text-secondary)' }}>{formatRp(rows.reduce((a, r) => a + r.hpp, 0))}</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: 'var(--text-secondary)' }}>{formatRp(total('labaKotor'))}</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: 'var(--text-secondary)' }}>{formatRp(rows.reduce((a, r) => a + r.bebanOperasional, 0))}</td>
                    <td className="px-3 py-2 text-right font-extrabold" style={{ color: total('labaBersih') >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatRp(total('labaBersih'))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </div>
  );
}
