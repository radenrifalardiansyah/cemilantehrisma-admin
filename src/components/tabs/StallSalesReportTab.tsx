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
import { HEADER_BTN_H, Badge, rupiah, qtyText } from './titip-jual/shared';

interface Report {
  stallOptions: { id: string; name: string }[];
  summary: { count: number; revenue: number; discount: number; ownRevenue: number; ownCost: number; consignSold: number; consignorShare: number; ourConsign: number; lossCompensation: number; storeShare: number; grossProfit: number };
  methods: { method: string; count: number; amount: number }[];
  daily: { date: string; count: number; revenue: number }[];
  stalls: { stallId: string; stallName: string; count: number; revenue: number }[];
  products: { kind: string; productId: string; name: string; qty: number; revenue: number }[];
  consignors: { consignorId: string; consignorName: string; sold: number; owed: number; ours: number; loss: number; unsettled: number; unpaid: number; paid: number }[];
}
interface PRow { kind: string; name: string; qty: number; revenue: number }

const METHOD: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' };
const todayKey = () => new Date().toLocaleDateString('en-CA');

async function fetchReport(creds: string, from: string, to: string, stallId: string): Promise<Report | null> {
  const r = await fetch(`/api/stall-pos/report?from=${from}&to=${to}&stallId=${stallId}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as Report : null;
}

// Keuangan → Laporan → Laporan Penjualan Lapak — terpisah dari laporan toko.
export default function StallSalesReportTab({ creds }: { creds: string }) {
  const toast = useToast();
  const store = useStoreHeader(creds);
  const [period, setPeriod] = useState<PeriodKey>('month');
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

  const label = `${from === to ? from : `${from} s/d ${to}`}${stallId ? ` · ${report?.stallOptions.find(s => s.id === stallId)?.name ?? ''}` : ' · semua lapak'}`;

  const consignorCols: ExportCol<Report['consignors'][number]>[] = [
    { header: 'Penitip', width: '22%', bold: true, value: c => c.consignorName },
    { header: 'Terjual', width: '13%', align: 'right', value: c => rupiah(c.sold) },
    { header: 'Bagian Penitip', width: '14%', align: 'right', value: c => rupiah(c.owed) },
    { header: 'Bagian Toko', width: '13%', align: 'right', value: c => rupiah(c.ours) },
    { header: 'Belum Direkap', width: '13%', align: 'right', value: c => rupiah(c.unsettled) },
    { header: 'Rekap Belum Dibayar', width: '13%', align: 'right', value: c => rupiah(c.unpaid) },
    { header: 'Sudah Dibayar', width: '12%', align: 'right', value: c => rupiah(c.paid) },
  ];
  const productCols: ExportCol<PRow>[] = [
    { header: 'Barang', width: '45%', bold: true, value: p => p.name },
    { header: 'Jenis', width: '15%', value: p => p.kind === 'consign' ? 'Titipan' : 'Toko' },
    { header: 'Terjual', width: '15%', align: 'right', value: p => qtyText(p.qty) },
    { header: 'Pendapatan', width: '25%', align: 'right', value: p => rupiah(p.revenue) },
  ];

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch { toast.error('Gagal membuat file.'); }
    setBusy('');
  };

  if (report === null) return <PageLoader />;
  const s = report.summary;
  const maxDaily = Math.max(1, ...report.daily.map(d => d.revenue));

  const cards = [
    { label: 'Omzet lapak', val: rupiah(s.revenue), sub: `${s.count} transaksi` },
    { label: 'Bagian toko', val: rupiah(s.storeShare), sub: 'produk toko + bagian toko dari titipan − diskon' },
    { label: 'Bagian penitip', val: rupiah(s.consignorShare), sub: s.lossCompensation > 0 ? `termasuk kompensasi kerugian ${rupiah(s.lossCompensation)}` : 'hutang ke penitip dari penjualan' },
    { label: 'Laba kotor lapak', val: rupiah(s.grossProfit), sub: 'bagian toko dikurangi HPP produk toko' },
  ];

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

  return (
    <div className="p-4 lg:p-6 space-y-4 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex-1 min-w-0"><PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} /></div>
        <div className="w-full sm:w-52">
          <FilterSelect value={stallId} onChange={setStallId} searchPlaceholder="Cari lapak…"
            options={[{ value: '', label: 'Semua lapak' }, ...report.stallOptions.map(x => ({ value: x.id, label: x.name }))]} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {cards.map(c => (
          <div key={c.label} className="card p-3 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            <p className="text-sm sm:text-base font-bold mt-0.5 break-words" style={{ color: 'var(--text-primary)' }}>{c.val}</p>
            <p className="text-[10px] mt-0.5 leading-tight" style={{ color: 'var(--text-muted)' }}>{c.sub}</p>
          </div>
        ))}
      </div>

      {s.count === 0 ? (
        <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada penjualan lapak pada periode ini.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="card p-4 space-y-2">
              <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Penjualan per hari</p>
              {report.daily.map(d => (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="w-20 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{d.date.slice(5)}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(d.revenue / maxDaily) * 100}%`, background: 'linear-gradient(135deg,#E8821A,#C96018)' }} />
                  </div>
                  <span className="w-24 text-right font-semibold flex-shrink-0">{rupiah(d.revenue)}</span>
                </div>
              ))}
            </div>
            <div className="card p-4 space-y-3">
              <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Metode pembayaran</p>
              <div className="flex flex-wrap gap-2">
                {report.methods.map(m => <Badge key={m.method} tone="accent">{METHOD[m.method] ?? m.method}: {rupiah(m.amount)} ({m.count}×)</Badge>)}
              </div>
              {!stallId && report.stalls.length > 1 && (
                <>
                  <p className="text-xs font-bold pt-1" style={{ color: 'var(--text-secondary)' }}>Per lapak</p>
                  {report.stalls.map(x => (
                    <div key={x.stallId} className="flex justify-between text-xs"><span>{x.stallName} <span style={{ color: 'var(--text-muted)' }}>· {x.count} transaksi</span></span><b>{rupiah(x.revenue)}</b></div>
                  ))}
                </>
              )}
              {s.discount > 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total diskon diberikan: {rupiah(s.discount)} (ditanggung toko)</p>}
            </div>
          </div>

          <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
            <div className="flex items-center justify-between gap-2 px-4 py-2.5" style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-2)' }}>
              <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Bagi hasil per penitip</p>
              {exportBar(report.consignors,
                () => exportExcel(consignorCols, report.consignors, 'LAPORAN BAGI HASIL PENITIP', label, 'laporan-bagi-hasil'),
                () => exportPdf(consignorCols, report.consignors, 'LAPORAN BAGI HASIL PENITIP', label, 'laporan-bagi-hasil', store), 'c')}
            </div>
            {report.consignors.length === 0 ? <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Tidak ada penjualan barang titipan.</p>
              : report.consignors.map((c, idx) => (
                <div key={c.consignorId} className="px-4 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{c.consignorName}</p>
                    <p className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>{rupiah(c.owed)}</p>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Terjual {rupiah(c.sold)} · bagian toko {rupiah(c.ours)}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {c.loss > 0 && <Badge tone="danger">Termasuk kompensasi kerugian {rupiah(c.loss)}</Badge>}
                    {c.unsettled > 0 && <Badge tone="danger">Belum direkap {rupiah(c.unsettled)}</Badge>}
                    {c.unpaid > 0 && <Badge tone="accent">Rekap belum dibayar {rupiah(c.unpaid)}</Badge>}
                    {c.paid > 0 && <Badge tone="ok">Sudah dibayar {rupiah(c.paid)}</Badge>}
                  </div>
                </div>
              ))}
          </div>

          <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
            <div className="flex items-center justify-between gap-2 px-4 py-2.5" style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-2)' }}>
              <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Barang terlaris</p>
              {exportBar(report.products,
                () => exportExcel(productCols, report.products, 'LAPORAN BARANG TERLARIS LAPAK', label, 'laporan-barang-lapak'),
                () => exportPdf(productCols, report.products, 'LAPORAN BARANG TERLARIS LAPAK', label, 'laporan-barang-lapak', store), 'p')}
            </div>
            {report.products.slice(0, 15).map((p, idx) => (
              <div key={`${p.kind}-${p.productId}`} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <span className="text-[11px] font-bold w-5 text-center flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.kind === 'consign' ? 'Titipan' : 'Toko'} · terjual {qtyText(p.qty)}</p>
                </div>
                <p className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{rupiah(p.revenue)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
