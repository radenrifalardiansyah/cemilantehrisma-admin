'use client';

import { useState, useEffect, useCallback } from 'react';
import { Banknote, Undo2, HandCoins, Loader2 } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import FilterSelect from '@/components/FilterSelect';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { periodRange, type PeriodKey } from '@/lib/period';
import DataList, { DetailPanel, type ExportCol } from '../titip-jual/DataList';
import PeriodBar from '../titip-jual/PeriodBar';
import { API, Badge, Field, ModalShell, ModalFooter, ErrorBox, StatCard, rupiah, qtyText } from '../titip-jual/shared';
import { dt, todayKey, type OwnSectionProps, type OwnSettlement, type OwnSettlementItem, type Wallet } from './types';

interface Payable { stallId: string; amount: number; lines: number; firstDate: string; lastDate: string }
interface Result { settlements: OwnSettlement[]; payables: Payable[] }

async function fetchSettlements(creds: string): Promise<Result> {
  const r = await fetch(`${API}/api/stall-own/settlements`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as Result : { settlements: [], payables: [] };
}

// Setoran lapak ke toko: hasil jualan produk toko di lapak. Buat Setoran (kunci penjualan periode itu) →
// Bayar (uang keluar dari dompet lapak, masuk Pemasukan toko ke dompet yang dipilih).
export default function SettlementsSection({ creds, stalls, can }: OwnSectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [result, setResult] = useState<Result | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [paying, setPaying] = useState<OwnSettlement | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => { setResult(await fetchSettlements(creds)); }, [creds]);
  useEffect(() => {
    let alive = true;
    fetchSettlements(creds).then(d => { if (alive) setResult(d); });
    return () => { alive = false; };
  }, [creds]);

  const stallName = (id: string) => stalls.find(s => s.id === id)?.name ?? '?';

  const cancel = async (s: OwnSettlement) => {
    if (!await confirm({ message: `Batalkan setoran ${s.docNumber}? Penjualannya bisa direkap ulang.`, danger: true })) return;
    setBusyId(s.id);
    const r = await fetch(`${API}/api/stall-own/settlements/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) { await load(); toast.success(`${s.docNumber} dibatalkan.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membatalkan setoran.');
    setBusyId(null);
  };

  if (result === null) return <PageLoader />;

  const items = result.settlements.filter(s => (!statusFilter || s.status === statusFilter) && (!stallFilter || s.stallId === stallFilter));
  const sum = (f: (s: OwnSettlement) => boolean) => result.settlements.filter(f).reduce((a, s) => a + s.totalAmount, 0);
  const owedUnsettled = result.payables.reduce((a, p) => a + p.amount, 0);
  const cols: ExportCol<OwnSettlement>[] = [
    { header: 'No. Setoran', width: '15%', bold: true, value: s => s.docNumber },
    { header: 'Lapak', width: '15%', value: s => s.stallName },
    { header: 'Periode', width: '20%', value: s => `${s.periodFrom} s/d ${s.periodTo}` },
    { header: 'Total', width: '15%', align: 'right', value: s => rupiah(s.totalAmount) },
    { header: 'Status', width: '15%', value: s => s.status === 'paid' ? 'Dibayar' : 'Belum dibayar' },
    { header: 'Dibayar', width: '20%', value: s => dt(s.paidAt) || '-' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={<HandCoins size={16} />} label="Belum direkap" value={rupiah(owedUnsettled)} color="var(--accent)" bg="var(--accent-bg)" valueColor={owedUnsettled > 0 ? 'var(--accent)' : undefined} />
        <StatCard icon={<Undo2 size={16} />} label="Setoran belum dibayar" value={rupiah(sum(s => s.status === 'unpaid'))} color="var(--danger)" bg="var(--danger-bg)" />
        <StatCard icon={<Banknote size={16} />} label="Sudah disetor" value={rupiah(sum(s => s.status === 'paid'))} color="#059669" bg="rgba(5,150,105,0.12)" />
      </div>

      {result.payables.length > 0 && (
        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
          <div className="px-4 py-2.5" style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-2)' }}>
            <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Belum direkap — hasil jualan produk toko yang belum disetor</p>
          </div>
          {result.payables.map((p, idx) => (
            <div key={p.stallId} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{stallName(p.stallId)}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.lines} transaksi · {p.firstDate === p.lastDate ? p.firstDate : `${p.firstDate} s/d ${p.lastDate}`}</p>
              </div>
              <p className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>{rupiah(p.amount)}</p>
              {can('create') && <button onClick={() => setCreating(p.stallId)} className="btn-primary text-xs flex-shrink-0" style={{ height: 32 }}>Buat Setoran</button>}
            </div>
          ))}
        </div>
      )}

      <DataList<OwnSettlement>
        creds={creds} items={items} totalCount={result.settlements.length} getId={s => s.id} noun="setoran"
        searchText={s => `${s.docNumber} ${s.stallName}`} searchPlaceholder="Cari no. setoran atau lapak…" viewKey="stall-own-settlements"
        resetKey={`${statusFilter}|${stallFilter}`}
        addLabel={can('create') ? 'Buat Setoran' : undefined} onAdd={can('create') ? () => setCreating('') : undefined}
        emptyHint="Setoran = ringkasan hasil jualan produk toko di lapak yang ditagih ke lapak, lalu dibayar dari dompet lapak sebagai Pemasukan toko."
        filters={(
          <>
            <FilterSelect value={statusFilter} onChange={setStatusFilter}
              options={[{ value: '', label: 'Semua status' }, { value: 'unpaid', label: 'Belum dibayar' }, { value: 'paid', label: 'Dibayar' }]} />
            <FilterSelect value={stallFilter} onChange={setStallFilter} searchPlaceholder="Cari lapak…"
              options={[{ value: '', label: 'Semua lapak' }, ...stalls.map(s => ({ value: s.id, label: s.name }))]} />
          </>
        )}
        renderBody={s => (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{s.docNumber}</p>
              <Badge tone={s.status === 'paid' ? 'ok' : 'danger'}>{s.status === 'paid' ? 'Dibayar' : 'Belum dibayar'}</Badge>
              <Badge>{s.stallName}</Badge>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.periodFrom === s.periodTo ? s.periodFrom : `${s.periodFrom} s/d ${s.periodTo}`}</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{rupiah(s.totalAmount)}</p>
          </>
        )}
        renderDetail={s => (
          <DetailPanel fields={[
            { label: 'Lapak', value: s.stallName }, { label: 'Periode', value: `${s.periodFrom} s/d ${s.periodTo}` },
            { label: 'Jumlah transaksi', value: String(s.linesCount) }, { label: 'Dibuat', value: `${dt(s.createdAt)}${s.createdBy ? ` · ${s.createdBy}` : ''}` },
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
            {s.status === 'unpaid' && can('edit') && (
              <Tooltip label="Bayar dari dompet lapak">
                <button onClick={() => setPaying(s)} disabled={busyId === s.id} className="btn-ghost p-2" style={{ color: '#059669' }}><Banknote size={13} /></button>
              </Tooltip>
            )}
            {s.status === 'unpaid' && can('delete') && (
              <Tooltip label="Batalkan setoran">
                <button onClick={() => cancel(s)} disabled={busyId === s.id} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}>
                  {busyId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                </button>
              </Tooltip>
            )}
          </>
        )}
        exportCols={cols} exportTitle="DAFTAR SETORAN PRODUK TOKO DI LAPAK" exportFile="setoran-lapak"
      />

      {creating !== null && (
        <CreateModal creds={creds} stalls={stalls} initialStallId={creating} onClose={() => setCreating(null)}
          onCreated={async doc => { setCreating(null); await load(); toast.success(`Setoran ${doc} dibuat. Lanjutkan dengan membayarnya.`); }} />
      )}
      {paying && (
        <PayModal creds={creds} settlement={paying} onClose={() => setPaying(null)}
          onPaid={async () => { const d = paying.docNumber; setPaying(null); await load(); toast.success(`${d} dibayar dan tercatat sebagai Pemasukan toko.`); }} />
      )}
    </div>
  );
}

interface Preview { items: OwnSettlementItem[]; total: number; count: number }

function CreateModal({ creds, stalls, initialStallId, onClose, onCreated }: {
  creds: string; stalls: OwnSectionProps['stalls']; initialStallId: string; onClose: () => void; onCreated: (docNumber: string) => Promise<void>;
}) {
  const [stallId, setStallId] = useState(initialStallId);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [all, setAll] = useState(!!initialStallId);
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const range = all ? { from: '2000-01-01', to: todayKey() } : periodRange(period, customFrom, customTo);

  useEffect(() => {
    if (!stallId) return;
    let alive = true;
    fetch(`${API}/api/stall-own/settlements/preview?stallId=${stallId}&from=${range.from}&to=${range.to}`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<Preview> : null)
      .then(d => { if (alive) setPreview(d); });
    return () => { alive = false; };
  }, [creds, stallId, range.from, range.to]);

  const create = async () => {
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/stall-own/settlements`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ stallId, from: range.from, to: range.to, note }),
    });
    const d = await r.json().catch(() => ({})) as { docNumber?: string; error?: string };
    if (r.ok && d.docNumber) await onCreated(d.docNumber);
    else setError(d.error ?? 'Gagal membuat setoran.');
    setSaving(false);
  };

  const shown = stallId ? preview : null;
  return (
    <ModalShell title="Buat Setoran Lapak" subtitle="Hasil jualan produk toko yang ditagih ke lapak" icon={<HandCoins size={17} />} onClose={onClose} size="modal-md"
      footer={<ModalFooter onClose={onClose} onSave={create} saving={saving} disabled={!shown || shown.count === 0} label="Buat Setoran" />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Lapak" required>
          <SearchSelect value={stallId} onChange={v => { setStallId(v); setPreview(null); }} placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…"
            options={stalls.map(s => ({ value: s.id, label: s.name, sublabel: s.code }))} />
        </Field>
        <div>
          <p className="field-label">Periode penjualan</p>
          <label className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={all} onChange={e => { setAll(e.target.checked); setPreview(null); }} /> Semua yang belum direkap (sampai hari ini)
          </label>
          {!all && <PeriodBar period={period} onPeriod={p => { setPeriod(p); setPreview(null); }} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} />}
        </div>
        {stallId && (
          <div className="card p-3" style={{ background: 'var(--surface-2)' }}>
            {shown === null ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Menghitung…</p>
              : shown.count === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tidak ada penjualan produk toko yang belum direkap pada periode ini.</p>
              : (
                <div className="space-y-1.5">
                  {shown.items.map(i => (
                    <div key={i.productId} className="flex justify-between gap-2 text-xs">
                      <span style={{ color: 'var(--text-secondary)' }}>{i.productName} ×{qtyText(i.qty)}</span><span>{rupiah(i.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-bold pt-1.5" style={{ borderTop: '1px solid var(--border)' }}>
                    <span>Total setoran ke toko</span><span style={{ color: 'var(--accent)' }}>{rupiah(shown.total)}</span>
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

function PayModal({ creds, settlement, onClose, onPaid }: { creds: string; settlement: OwnSettlement; onClose: () => void; onPaid: () => Promise<void> }) {
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [walletId, setWalletId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/wallets`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<{ wallets: Wallet[] }> : { wallets: [] })
      .then(d => { if (alive) setWallets(d.wallets.filter(w => w.isActive !== false)); });
    return () => { alive = false; };
  }, [creds]);

  const pay = async () => {
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/stall-own/settlements/${settlement.id}/pay`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ walletId }),
    });
    if (r.ok) await onPaid();
    else setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membayar setoran.');
    setSaving(false);
  };

  return (
    <ModalShell title="Bayar Setoran" subtitle={`${settlement.docNumber} · ${settlement.stallName}`} icon={<Banknote size={17} />} onClose={onClose}
      footer={<ModalFooter onClose={onClose} onSave={pay} saving={saving} disabled={!walletId} label={`Bayar ${rupiah(settlement.totalAmount)}`} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Saldo dompet {settlement.stallName} berkurang {rupiah(settlement.totalAmount)}, dan jumlah yang sama tercatat sebagai <strong>Pemasukan</strong> toko ke dompet yang dipilih.
        </p>
        <Field label="Masuk ke dompet toko" required>
          {wallets === null ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Memuat dompet…</p> : (
            <SearchSelect value={walletId} onChange={setWalletId} placeholder="– Pilih dompet –" searchPlaceholder="Cari dompet…"
              options={wallets.map(w => ({ value: w.id, label: w.name }))} />
          )}
        </Field>
        <ErrorBox message={error} />
      </div>
    </ModalShell>
  );
}
