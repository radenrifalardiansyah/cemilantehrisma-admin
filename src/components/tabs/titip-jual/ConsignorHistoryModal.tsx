'use client';

import { useState, useEffect } from 'react';
import { History, PackagePlus, PackageMinus, ArrowRightLeft, ClipboardCheck, ShoppingCart, RotateCcw, ClipboardList, Banknote, Loader2 } from 'lucide-react';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import { useToast } from '@/components/Toast';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { periodRange, type PeriodKey } from '@/lib/period';
import PeriodBar from './PeriodBar';
import { exportExcel, exportPdf, type ExportCol } from './exporters';
import { API, HEADER_BTN_H, ModalShell, rupiah, qtyText } from './shared';

type EventType = 'receive' | 'return' | 'transfer' | 'adjust' | 'sale' | 'sale_return' | 'settlement' | 'payment';
interface HistoryEvent { at: number; type: EventType; stallName: string; title: string; detail: string; amount: number | null; ref: string }
interface HistoryData {
  consignor: { id: string; name: string };
  summary: { stockQty: number; stockProducts: number; soldAmount: number; receivedCount: number; paidAmount: number; unsettled: number; unpaid: number; paidTotal: number };
  events: HistoryEvent[];
}

const TYPE_META: Record<EventType, { label: string; Icon: React.ElementType; color: string }> = {
  receive: { label: 'Terima barang', Icon: PackagePlus, color: '#059669' },
  return: { label: 'Retur ke penitip', Icon: PackageMinus, color: 'var(--accent)' },
  transfer: { label: 'Pindah lapak', Icon: ArrowRightLeft, color: 'var(--text-secondary)' },
  adjust: { label: 'Penyesuaian stok', Icon: ClipboardCheck, color: 'var(--danger)' },
  sale: { label: 'Penjualan', Icon: ShoppingCart, color: '#059669' },
  sale_return: { label: 'Retur penjualan', Icon: RotateCcw, color: 'var(--danger)' },
  settlement: { label: 'Rekap', Icon: ClipboardList, color: 'var(--accent)' },
  payment: { label: 'Pembayaran', Icon: Banknote, color: '#059669' },
};
const todayKey = () => new Date().toLocaleDateString('en-CA');
const dt = (ms: number) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function fetchHistory(creds: string, id: string, from: string, to: string): Promise<HistoryData | null> {
  const r = await fetch(`${API}/api/consignors/${id}/history?from=${from}&to=${to}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as HistoryData : null;
}

// Riwayat & ringkasan satu penitip: posisi stok/hutang saat ini + linimasa kegiatan pada periode.
export default function ConsignorHistoryModal({ creds, consignor, onClose }: { creds: string; consignor: { id: string; name: string }; onClose: () => void }) {
  const toast = useToast();
  const store = useStoreHeader(creds);
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const { from, to } = periodRange(period, customFrom, customTo);
  const [data, setData] = useState<HistoryData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    fetchHistory(creds, consignor.id, from, to).then(d => { if (alive) { setData(d); setFailed(!d); } });
    return () => { alive = false; };
  }, [creds, consignor.id, from, to]);

  const cols: ExportCol<HistoryEvent>[] = [
    { header: 'Waktu', width: '16%', value: e => dt(e.at) },
    { header: 'Jenis', width: '14%', value: e => TYPE_META[e.type].label },
    { header: 'Lapak', width: '12%', value: e => e.stallName || '-' },
    { header: 'Keterangan', width: '38%', value: e => `${e.title}${e.detail ? ` — ${e.detail}` : ''}` },
    { header: 'Nilai', width: '14%', align: 'right', value: e => e.amount === null ? '-' : rupiah(e.amount) },
  ];
  const label = `${consignor.name} · ${from === to ? from : `${from} s/d ${to}`}`;
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch { toast.error('Gagal membuat file.'); } setBusy(''); };

  const s = data?.summary;
  const tiles = s ? [
    { label: 'Stok titipan sekarang', main: `${qtyText(s.stockQty)} pcs`, note: `${s.stockProducts} produk` },
    { label: 'Penjualan (bagian penitip)', main: rupiah(s.soldAmount), note: 'pada periode' },
    { label: 'Belum direkap', main: rupiah(s.unsettled), color: s.unsettled > 0 ? 'var(--accent)' : undefined },
    { label: 'Rekap belum dibayar', main: rupiah(s.unpaid), color: s.unpaid > 0 ? 'var(--danger)' : undefined },
    { label: 'Sudah dibayar (total)', main: rupiah(s.paidTotal), color: '#059669' },
    { label: 'Dibayar pada periode', main: rupiah(s.paidAmount) },
  ] : [];

  return (
    <ModalShell title="Riwayat Penitip" subtitle={consignor.name} icon={<History size={17} />} onClose={onClose} size="modal-lg"
      footer={<button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex-1 min-w-0"><PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} /></div>
          {data && data.events.length > 0 && (
            <div className="flex items-center gap-2">
              <Tooltip label="Export Excel">
                <button onClick={() => run('x', () => exportExcel(cols, data.events, `RIWAYAT PENITIP — ${consignor.name.toUpperCase()}`, label, 'riwayat-penitip'))} disabled={!!busy}
                  className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {busy === 'x' ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={14} />}
                </button>
              </Tooltip>
              <Tooltip label="Export PDF">
                <button onClick={() => run('p', () => exportPdf(cols, data.events, `RIWAYAT PENITIP — ${consignor.name.toUpperCase()}`, label, 'riwayat-penitip', store))} disabled={!!busy}
                  className="btn-ghost p-0 flex items-center justify-center" style={{ height: HEADER_BTN_H, width: HEADER_BTN_H }}>
                  {busy === 'p' ? <Loader2 size={14} className="animate-spin" /> : <PdfIcon size={14} />}
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {failed ? <p className="text-sm text-center py-8" style={{ color: 'var(--danger)' }}>Gagal memuat riwayat penitip.</p> : data === null ? <PageLoader /> : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {tiles.map(t => (
                <div key={t.label} className="flex flex-col justify-between px-3 py-2 rounded-lg min-h-[56px] min-w-0" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-[9px] font-semibold uppercase leading-tight" style={{ color: 'var(--text-muted)' }}>{t.label}</p>
                  <div className="min-w-0">
                    <p className="text-xs font-bold tabular leading-tight mt-0.5 truncate" style={{ color: t.color ?? 'var(--text-primary)' }}>{t.main}</p>
                    {t.note && <p className="text-[10px] tabular leading-tight" style={{ color: 'var(--text-muted)' }}>{t.note}</p>}
                  </div>
                </div>
              ))}
            </div>

            {data.events.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Tidak ada kegiatan pada periode ini.</p>
            ) : (
              <div>
                {data.events.map((e, idx) => {
                  const m = TYPE_META[e.type];
                  return (
                    <div key={idx} className="flex items-start gap-3 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: m.color }}><m.Icon size={15} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{e.title}</p>
                        {e.detail && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{e.detail}</p>}
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{dt(e.at)}{e.stallName ? ` · ${e.stallName}` : ''}</p>
                      </div>
                      {e.amount !== null && (
                        <p className="text-sm font-bold tabular flex-shrink-0" style={{ color: e.amount < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{rupiah(e.amount)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
