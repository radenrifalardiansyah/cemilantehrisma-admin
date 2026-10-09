'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import FilterSelect from '@/components/FilterSelect';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import { useToast } from '@/components/Toast';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { periodRange, type PeriodKey } from '@/lib/period';
import PeriodBar from './titip-jual/PeriodBar';
import { exportExcel, exportPdf, type ExportCol } from './titip-jual/exporters';
import { HEADER_BTN_H, Badge, rupiah } from './titip-jual/shared';

interface Ts { seconds: number }
interface Report {
  stalls: { id: string; name: string }[];
  names: Record<string, string>;
  summary: { count: number; revenue: number; discount: number };
  cashiers: { cashier: string; count: number; revenue: number; discount: number; cash: number; qris: number; transfer: number; voids: number; voidAmount: number }[];
  shifts: { id: string; stallName: string; openedBy: string; closedBy: string; status: string; openedAt: Ts | null; closedAt: Ts | null; openingBalance: number;
            cashSales: number | null; expected: number | null; actual: number | null; difference: number | null }[];
}
type CashierRow = Report['cashiers'][number];
type ShiftRow = Report['shifts'][number];

const todayKey = () => new Date().toLocaleDateString('en-CA');
const dt = (t: Ts | null) => t ? new Date(t.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

async function fetchReport(creds: string, from: string, to: string, stallId: string): Promise<Report | null> {
  const r = await fetch(`/api/stall-pos/cashier-report?from=${from}&to=${to}&stallId=${stallId}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as Report : null;
}

// Keuangan → Laporan → Laporan Penjualan per Kasir (lapak). Satu laci bersama per lapak; kasir bisa
// berganti-ganti, jadi laporan ini merekap penjualan per kasir dan riwayat shift (siapa buka/tutup laci).
export default function CashierSalesReportTab({ creds }: { creds: string }) {
  const toast = useToast();
  const store = useStoreHeader(creds);
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const [stallId, setStallId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState('');
  const { from, to } = periodRange(period, customFrom, customTo);

  useEffect(() => {
    let alive = true;
    fetchReport(creds, from, to, stallId).then(d => { if (alive) setReport(d); });
    return () => { alive = false; };
  }, [creds, from, to, stallId]);

  if (report === null) return <PageLoader />;
  const name = (u: string) => report.names[u] || u;
  const label = `${from === to ? from : `${from} s/d ${to}`}${stallId ? ` · ${report.stalls.find(s => s.id === stallId)?.name ?? ''}` : ' · semua lapak'}`;

  const cashierCols: ExportCol<CashierRow>[] = [
    { header: 'Kasir', width: '18%', bold: true, value: c => name(c.cashier) },
    { header: 'Transaksi', width: '10%', align: 'right', value: c => c.count },
    { header: 'Omzet', width: '14%', align: 'right', value: c => rupiah(c.revenue) },
    { header: 'Tunai', width: '12%', align: 'right', value: c => rupiah(c.cash) },
    { header: 'QRIS', width: '12%', align: 'right', value: c => rupiah(c.qris) },
    { header: 'Transfer', width: '12%', align: 'right', value: c => rupiah(c.transfer) },
    { header: 'Diskon', width: '10%', align: 'right', value: c => rupiah(c.discount) },
    { header: 'Batal', width: '12%', align: 'right', value: c => c.voids > 0 ? `${c.voids}× (${rupiah(c.voidAmount)})` : '-' },
  ];
  const shiftCols: ExportCol<ShiftRow>[] = [
    { header: 'Lapak', width: '12%', bold: true, value: s => s.stallName },
    { header: 'Dibuka', width: '15%', value: s => `${dt(s.openedAt)} · ${name(s.openedBy)}` },
    { header: 'Ditutup', width: '15%', value: s => s.closedAt ? `${dt(s.closedAt)} · ${name(s.closedBy)}` : 'Masih terbuka' },
    { header: 'Kas Awal', width: '10%', align: 'right', value: s => rupiah(s.openingBalance) },
    { header: 'Tunai', width: '10%', align: 'right', value: s => s.cashSales === null ? '-' : rupiah(s.cashSales) },
    { header: 'Seharusnya', width: '12%', align: 'right', value: s => s.expected === null ? '-' : rupiah(s.expected) },
    { header: 'Hitungan', width: '12%', align: 'right', value: s => s.actual === null ? '-' : rupiah(s.actual) },
    { header: 'Selisih', width: '10%', align: 'right', value: s => s.difference === null ? '-' : `${s.difference > 0 ? '+' : ''}${rupiah(s.difference)}` },
  ];

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch { toast.error('Gagal membuat file.'); }
    setBusy('');
  };
  const exportBar = (rows: unknown[], onExcel: () => Promise<void>, onPdf: () => Promise<void>, key: string) => rows.length > 0 && (
    <div className="flex items-center gap-2">
      <Tooltip label="Export Excel">
        <button onClick={() => run(`${key}x`, onExcel)} disabled={!!busy} className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
          {busy === `${key}x` ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
        </button>
      </Tooltip>
      <Tooltip label="Export PDF">
        <button onClick={() => run(`${key}p`, onPdf)} disabled={!!busy} className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
          {busy === `${key}p` ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
        </button>
      </Tooltip>
    </div>
  );
  const head = { background: 'var(--surface-2)', borderBottom: '1px solid var(--border-2)' } as const;
  const s = report.summary;

  return (
    <div className="p-4 lg:p-6 space-y-4 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex-1 min-w-0"><PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} /></div>
        <div className="w-full sm:w-52">
          <FilterSelect value={stallId} onChange={setStallId} searchPlaceholder="Cari lapak…"
            options={[{ value: '', label: 'Semua lapak' }, ...report.stalls.map(x => ({ value: x.id, label: x.name }))]} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: 'Omzet lapak', val: rupiah(s.revenue) },
          { label: 'Transaksi', val: String(s.count) },
          { label: 'Rata-rata/transaksi', val: s.count > 0 ? rupiah(s.revenue / s.count) : '-' },
        ].map(c => (
          <div key={c.label} className="card p-2.5 sm:p-3 min-w-0">
            <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            <p className="text-xs sm:text-sm font-bold mt-0.5 break-words" style={{ color: 'var(--text-primary)' }}>{c.val}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5" style={head}>
          <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Penjualan per kasir</p>
          {exportBar(report.cashiers,
            () => exportExcel(cashierCols, report.cashiers, 'LAPORAN PENJUALAN PER KASIR LAPAK', label, 'laporan-penjualan-kasir-lapak'),
            () => exportPdf(cashierCols, report.cashiers, 'LAPORAN PENJUALAN PER KASIR LAPAK', label, 'laporan-penjualan-kasir-lapak', store), 'k')}
        </div>
        {report.cashiers.length === 0 ? <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada penjualan lapak pada periode ini.</p>
          : report.cashiers.map((c, idx) => (
            <div key={c.cashier} className="px-4 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{name(c.cashier)} <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>@{c.cashier}</span></p>
                <p className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>{rupiah(c.revenue)}</p>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.count} transaksi{c.count > 0 ? ` · rata-rata ${rupiah(c.revenue / c.count)}` : ''}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {c.cash > 0 && <Badge>Tunai {rupiah(c.cash)}</Badge>}
                {c.qris > 0 && <Badge>QRIS {rupiah(c.qris)}</Badge>}
                {c.transfer > 0 && <Badge>Transfer {rupiah(c.transfer)}</Badge>}
                {c.discount > 0 && <Badge tone="accent">Diskon {rupiah(c.discount)}</Badge>}
                {c.voids > 0 && <Badge tone="danger">{c.voids} dibatalkan ({rupiah(c.voidAmount)})</Badge>}
              </div>
            </div>
          ))}
      </div>

      <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5" style={head}>
          <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Riwayat shift (laci kas bersama)</p>
          {exportBar(report.shifts,
            () => exportExcel(shiftCols, report.shifts, 'LAPORAN SHIFT KASIR LAPAK', label, 'laporan-shift-lapak'),
            () => exportPdf(shiftCols, report.shifts, 'LAPORAN SHIFT KASIR LAPAK', label, 'laporan-shift-lapak', store), 's')}
        </div>
        {report.shifts.length === 0 ? <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Belum ada shift pada periode ini.</p>
          : report.shifts.map((sh, idx) => (
            <div key={sh.id} className="px-4 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{sh.stallName}</p>
                {sh.status === 'open' ? <Badge tone="ok">Masih terbuka</Badge>
                  : sh.difference === 0 ? <Badge tone="ok">Kas sesuai</Badge>
                  : <Badge tone="danger">Selisih {sh.difference !== null && sh.difference > 0 ? '+' : '-'}{rupiah(Math.abs(sh.difference ?? 0))}</Badge>}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Dibuka {dt(sh.openedAt)} oleh {name(sh.openedBy)}{sh.closedAt ? ` · ditutup ${dt(sh.closedAt)} oleh ${name(sh.closedBy)}` : ''}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Kas awal {rupiah(sh.openingBalance)}{sh.cashSales !== null ? ` + tunai ${rupiah(sh.cashSales)} = seharusnya ${rupiah(sh.expected ?? 0)} · hitungan ${rupiah(sh.actual ?? 0)}` : ''}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}
