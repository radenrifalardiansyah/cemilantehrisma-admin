'use client';

import { useState, useEffect, useCallback } from 'react';
import { Banknote, Undo2, FileDown, Loader2, HandCoins } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import FilterSelect from '@/components/FilterSelect';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { periodRange, type PeriodKey } from '@/lib/period';
import DataList, { DetailPanel, type ExportCol } from './DataList';
import PeriodBar from './PeriodBar';
import { downloadSettlementPdf, type Settlement, type SettlementItem } from './settlementPdf';
import { API, Badge, Field, ModalShell, ModalFooter, ErrorBox, rupiah, qtyText, type SectionProps } from './shared';

interface Payable { stallId: string; consignorId: string; consignorName: string; amount: number; lines: number; firstDate: string; lastDate: string }
interface Result { settlements: Settlement[]; payables: Payable[] }

const todayKey = () => new Date().toLocaleDateString('en-CA');
const dt = (t: { seconds: number } | null) => t ? new Date(t.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

async function fetchSettlements(creds: string): Promise<Result> {
  const r = await fetch(`${API}/api/consign/settlements`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as Result : { settlements: [], payables: [] };
}

// Rekap bagi hasil & pembayaran ke penitip. Alur: Buat Rekap (kunci penjualan periode itu) →
// Bayar (dari dompet lapak). Rekap yang belum dibayar bisa dibatalkan; yang sudah dibayar tidak.
export default function SettlementsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const store = useStoreHeader(creds);
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [result, setResult] = useState<Result | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [consignorFilter, setConsignorFilter] = useState('');
  const [creating, setCreating] = useState<{ stallId: string; consignorId: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => { setResult(await fetchSettlements(creds)); }, [creds]);
  useEffect(() => {
    let alive = true;
    fetchSettlements(creds).then(d => { if (alive) setResult(d); });
    return () => { alive = false; };
  }, [creds]);

  const stallName = (id: string) => data.stalls.find(s => s.id === id)?.name ?? '?';

  const pay = async (s: Settlement) => {
    if (!await confirm({ message: `Bayar ${rupiah(s.totalAmount)} ke ${s.consignorName} dari dompet ${s.stallName}? Saldo dompet lapak akan berkurang.` })) return;
    setBusyId(s.id);
    const r = await fetch(`${API}/api/consign/settlements/${s.id}/pay`, { method: 'POST', headers });
    if (r.ok) { await Promise.all([load(), reload()]); toast.success(`${s.docNumber} dibayar.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membayar rekap.');
    setBusyId(null);
  };

  const cancel = async (s: Settlement) => {
    if (!await confirm({ message: `Batalkan rekap ${s.docNumber}? Penjualannya bisa direkap ulang.`, danger: true })) return;
    setBusyId(s.id);
    const r = await fetch(`${API}/api/consign/settlements/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) { await load(); toast.success(`${s.docNumber} dibatalkan.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membatalkan rekap.');
    setBusyId(null);
  };

  const downloadPdf = async (s: Settlement) => {
    setBusyId(s.id);
    try { await downloadSettlementPdf(s, store); }
    catch { toast.error('Gagal membuat PDF.'); }
    setBusyId(null);
  };

  if (result === null) return <PageLoader />;

  const items = result.settlements
    .filter(s => !statusFilter || s.status === statusFilter)
    .filter(s => !stallFilter || s.stallId === stallFilter)
    .filter(s => !consignorFilter || s.consignorId === consignorFilter);
  const sum = (f: (s: Settlement) => boolean) => result.settlements.filter(f).reduce((a, s) => a + s.totalAmount, 0);
  const owedUnsettled = result.payables.reduce((a, p) => a + p.amount, 0);

  const cols: ExportCol<Settlement>[] = [
    { header: 'No. Rekap', width: '13%', bold: true, value: s => s.docNumber },
    { header: 'Penitip', width: '15%', value: s => s.consignorName },
    { header: 'Lapak', width: '11%', value: s => s.stallName },
    { header: 'Periode', width: '17%', value: s => `${s.periodFrom} s/d ${s.periodTo}` },
    { header: 'Total', width: '12%', align: 'right', value: s => rupiah(s.totalAmount) },
    { header: 'Status', width: '10%', value: s => s.status === 'paid' ? 'Dibayar' : 'Belum dibayar' },
    { header: 'Dibayar', width: '13%', value: s => dt(s.paidAt) || '-' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: 'Belum direkap', val: rupiah(owedUnsettled), tone: owedUnsettled > 0 ? 'var(--accent)' : undefined },
          { label: 'Rekap belum dibayar', val: rupiah(sum(s => s.status === 'unpaid')) },
          { label: 'Sudah dibayar', val: rupiah(sum(s => s.status === 'paid')) },
        ].map(c => (
          <div key={c.label} className="card p-2.5 sm:p-3 min-w-0">
            <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            <p className="text-xs sm:text-sm font-bold mt-0.5 break-words" style={{ color: c.tone ?? 'var(--text-primary)' }}>{c.val}</p>
          </div>
        ))}
      </div>

      {result.payables.length > 0 && (
        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
          <div className="px-4 py-2.5" style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-2)' }}>
            <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Belum direkap — hutang ke penitip dari penjualan yang belum dimasukkan rekap</p>
          </div>
          {result.payables.map((p, idx) => (
            <div key={`${p.stallId}-${p.consignorId}`} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.consignorName}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{stallName(p.stallId)} · {p.lines} penjualan · {p.firstDate === p.lastDate ? p.firstDate : `${p.firstDate} s/d ${p.lastDate}`}</p>
              </div>
              <p className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>{rupiah(p.amount)}</p>
              {can('create') && (
                <button onClick={() => setCreating({ stallId: p.stallId, consignorId: p.consignorId })} className="btn-primary text-xs flex-shrink-0" style={{ height: 32 }}>Buat Rekap</button>
              )}
            </div>
          ))}
        </div>
      )}

      <DataList<Settlement>
        creds={creds} items={items} totalCount={result.settlements.length} getId={s => s.id} noun="rekap"
        searchText={s => `${s.docNumber} ${s.consignorName} ${s.stallName}`} searchPlaceholder="Cari no. rekap, penitip, atau lapak…" viewKey="consign-settlements"
        resetKey={`${statusFilter}|${stallFilter}|${consignorFilter}`}
        addLabel={can('create') ? 'Buat Rekap' : undefined} onAdd={can('create') ? () => setCreating({ stallId: '', consignorId: '' }) : undefined}
        emptyHint="Rekap = ringkasan bagian penitip dari penjualan lapak, lalu dibayar dari dompet lapak."
        filters={(
          <>
            <FilterSelect value={statusFilter} onChange={setStatusFilter}
              options={[{ value: '', label: 'Semua status' }, { value: 'unpaid', label: 'Belum dibayar' }, { value: 'paid', label: 'Dibayar' }]} />
            <FilterSelect value={stallFilter} onChange={setStallFilter} searchPlaceholder="Cari lapak…"
              options={[{ value: '', label: 'Semua lapak' }, ...data.stalls.map(s => ({ value: s.id, label: s.name }))]} />
            <FilterSelect value={consignorFilter} onChange={setConsignorFilter} searchPlaceholder="Cari penitip…"
              options={[{ value: '', label: 'Semua penitip' }, ...data.consignors.map(c => ({ value: c.id, label: c.name }))]} />
          </>
        )}
        renderBody={s => (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{s.docNumber}</p>
              <Badge tone={s.status === 'paid' ? 'ok' : 'danger'}>{s.status === 'paid' ? 'Dibayar' : 'Belum dibayar'}</Badge>
              <Badge>{s.stallName}</Badge>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.consignorName} · {s.periodFrom === s.periodTo ? s.periodFrom : `${s.periodFrom} s/d ${s.periodTo}`}</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{rupiah(s.totalAmount)}</p>
          </>
        )}
        renderDetail={s => (
          <DetailPanel fields={[
            { label: 'Penitip', value: s.consignorName }, { label: 'Lapak', value: s.stallName },
            { label: 'Periode', value: `${s.periodFrom} s/d ${s.periodTo}` }, { label: 'Jumlah penjualan', value: String(s.linesCount) },
            { label: 'Dibuat', value: `${dt(s.createdAt)}${s.createdBy ? ` · ${s.createdBy}` : ''}` },
            { label: 'Dibayar', value: s.paidAt ? `${dt(s.paidAt)}${s.paidBy ? ` · ${s.paidBy}` : ''}` : '' },
            ...(s.note ? [{ label: 'Catatan', value: s.note, wide: true }] : []),
          ]}>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Rincian per produk</p>
              {s.items.map(i => (
                <div key={i.productId} className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{i.productName} <span style={{ color: 'var(--text-muted)' }}>×{qtyText(i.qty)}</span></span>
                  <span style={{ color: 'var(--text-secondary)' }}>{rupiah(i.amount)}</span>
                </div>
              ))}
            </div>
          </DetailPanel>
        )}
        actions={s => (
          <>
            <Tooltip label="Unduh PDF">
              <button onClick={() => downloadPdf(s)} disabled={busyId === s.id} className="btn-ghost p-2">
                {busyId === s.id ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              </button>
            </Tooltip>
            {s.status === 'unpaid' && can('edit') && (
              <Tooltip label="Bayar dari dompet lapak">
                <button onClick={() => pay(s)} disabled={busyId === s.id} className="btn-ghost p-2" style={{ color: '#059669' }}><Banknote size={13} /></button>
              </Tooltip>
            )}
            {s.status === 'unpaid' && can('delete') && (
              <Tooltip label="Batalkan rekap">
                <button onClick={() => cancel(s)} disabled={busyId === s.id} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Undo2 size={13} /></button>
              </Tooltip>
            )}
          </>
        )}
        exportCols={cols} exportTitle="DAFTAR REKAP BAGI HASIL PENITIP" exportFile="rekap-penitip"
      />

      {creating && (
        <CreateModal creds={creds} data={data} initial={creating} onClose={() => setCreating(null)}
          onCreated={async (doc) => { setCreating(null); await Promise.all([load(), reload()]); toast.success(`Rekap ${doc} dibuat. Lanjutkan dengan membayar dari dompet lapak.`); }} />
      )}
    </div>
  );
}

interface Preview { items: SettlementItem[]; total: number; count: number }

function CreateModal({ creds, data, initial, onClose, onCreated }: {
  creds: string; data: SectionProps['data']; initial: { stallId: string; consignorId: string }; onClose: () => void; onCreated: (docNumber: string) => Promise<void>;
}) {
  const [stallId, setStallId] = useState(initial.stallId);
  const [consignorId, setConsignorId] = useState(initial.consignorId);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [all, setAll] = useState(!!initial.stallId);   // dari "Belum direkap": ambil semua yang tersisa
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const range = all ? { from: '2000-01-01', to: todayKey() } : periodRange(period, customFrom, customTo);
  const ready = !!stallId && !!consignorId;

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    fetch(`${API}/api/consign/settlements/preview?stallId=${stallId}&consignorId=${consignorId}&from=${range.from}&to=${range.to}`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<Preview> : null)
      .then(d => { if (alive) setPreview(d); });
    return () => { alive = false; };
  }, [creds, ready, stallId, consignorId, range.from, range.to]);

  const create = async () => {
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/consign/settlements`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stallId, consignorId, from: range.from, to: range.to, note }),
    });
    const d = await r.json().catch(() => ({})) as { docNumber?: string; error?: string };
    if (r.ok && d.docNumber) await onCreated(d.docNumber);
    else setError(d.error ?? 'Gagal membuat rekap.');
    setSaving(false);
  };

  const shown = ready ? preview : null;
  return (
    <ModalShell title="Buat Rekap Bagi Hasil" subtitle="Bagian penitip dari penjualan lapak" icon={<HandCoins size={17} />} onClose={onClose} size="modal-md"
      footer={<ModalFooter onClose={onClose} onSave={create} saving={saving} disabled={!shown || shown.count === 0} label="Buat Rekap" />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Lapak" required>
            <SearchSelect value={stallId} onChange={setStallId} placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…"
              options={data.stalls.map(s => ({ value: s.id, label: s.name, sublabel: s.code }))} />
          </Field>
          <Field label="Penitip" required>
            <SearchSelect value={consignorId} onChange={setConsignorId} placeholder="– Pilih penitip –" searchPlaceholder="Cari penitip…"
              options={data.consignors.map(c => ({ value: c.id, label: c.name, sublabel: c.code, imageUrl: c.logoUrl || undefined }))} />
          </Field>
        </div>

        <div>
          <p className="field-label">Periode penjualan</p>
          <label className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Semua yang belum direkap (sampai hari ini)
          </label>
          {!all && <PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} />}
          {!all && <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Rekap harian: pilih Hari Ini · mingguan: 7 Hari · bulanan: Bulan Ini.</p>}
        </div>

        {ready && (
          <div className="card p-3" style={{ background: 'var(--surface-2)' }}>
            {shown === null ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Menghitung…</p>
              : shown.count === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tidak ada penjualan yang belum direkap pada periode ini.</p>
              : (
                <div className="space-y-1.5">
                  {shown.items.map(i => (
                    <div key={i.productId} className="flex justify-between gap-2 text-xs">
                      <span style={{ color: 'var(--text-secondary)' }}>{i.productName} ×{qtyText(i.qty)}</span><span>{rupiah(i.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-bold pt-1.5" style={{ borderTop: '1px solid var(--border)' }}>
                    <span>Total untuk penitip</span><span style={{ color: 'var(--accent)' }}>{rupiah(shown.total)}</span>
                  </div>
                </div>
              )}
          </div>
        )}
        <Field label="Catatan (opsional)"><input className="input" value={note} maxLength={200} onChange={e => setNote(e.target.value)} /></Field>
        <ErrorBox message={error} />
      </div>
    </ModalShell>
  );
}
