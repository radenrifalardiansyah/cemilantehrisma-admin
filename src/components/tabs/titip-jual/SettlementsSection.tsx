'use client';

import { useState, useEffect, useCallback } from 'react';
import { Camera, ImagePlus, X, ExternalLink, Banknote, Undo2, Loader2, HandCoins, MessageCircle, Pencil, Trash2, Wallet, CheckCircle2 } from 'lucide-react';
import { PdfIcon } from '@/components/FileTypeIcons';
import SearchSelect from '@/components/SearchSelect';
import FilterSelect from '@/components/FilterSelect';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { useWallets } from '@/lib/useWallets';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { periodRange, type PeriodKey } from '@/lib/period';
import DataList, { DetailPanel, type ExportCol } from './DataList';
import PeriodBar from './PeriodBar';
import { waLink, settlementMessage } from '@/lib/stall-whatsapp';
import { downloadSettlementPdf, type Settlement, type SettlementItem, type SettlementConsignor } from './settlementPdf';
import { API, Badge, Field, ModalShell, ModalFooter, ErrorBox, rupiah, qtyText, uploadImage, type SectionProps } from './shared';

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
export default function SettlementsSection({ creds, data, reload, can, openJournal }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const store = useStoreHeader(creds);
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [result, setResult] = useState<Result | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [consignorFilter, setConsignorFilter] = useState('');
  const [creating, setCreating] = useState<{ stallId: string; consignorId: string } | null>(null);
  const [editingDoc, setEditingDoc] = useState<Settlement | null>(null);
  const [payingDoc, setPayingDoc] = useState<Settlement | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<'pdf' | 'pay' | null>(null);
  const [bulkPaying, setBulkPaying] = useState<{ list: Settlement[]; skipped: number; clear: () => void } | null>(null);

  const load = useCallback(async () => { setResult(await fetchSettlements(creds)); }, [creds]);
  useEffect(() => {
    let alive = true;
    fetchSettlements(creds).then(d => { if (alive) setResult(d); });
    return () => { alive = false; };
  }, [creds]);

  const stallName = (id: string) => data.stalls.find(s => s.id === id)?.name ?? '?';

  // Data penitip untuk blok "Penerima" di nota PDF (rekening, alamat, telepon).
  const consignorFor = (s: Settlement): SettlementConsignor | undefined => {
    const c = data.consignors.find(x => x.id === s.consignorId);
    return c ? { name: c.name, phone: c.phone || undefined, address: c.address || undefined, bankName: c.bankName || undefined, bankAccount: c.bankAccount || undefined, bankHolder: c.bankHolder || undefined } : undefined;
  };

  const unpay = async (s: Settlement) => {
    if (!await confirm({ message: `Batalkan pembayaran ${s.docNumber}? ${rupiah(s.totalAmount)} dikembalikan ke dompet ${s.stallName} dan rekap kembali "Belum dibayar" (lalu bisa diubah atau dihapus).`, danger: true })) return;
    setBusyId(s.id);
    const r = await fetch(`${API}/api/consign/settlements/${s.id}/unpay`, { method: 'POST', headers });
    if (r.ok) { await Promise.all([load(), reload()]); toast.success(`Pembayaran ${s.docNumber} dibatalkan.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membatalkan pembayaran.');
    setBusyId(null);
  };

  const cancel = async (s: Settlement) => {
    if (!await confirm({ message: `Hapus rekap ${s.docNumber}? Penjualannya bisa direkap ulang.`, danger: true })) return;
    setBusyId(s.id);
    const r = await fetch(`${API}/api/consign/settlements/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) { await load(); toast.success(`${s.docNumber} dihapus.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menghapus rekap.');
    setBusyId(null);
  };

  const waData = (s: Settlement) => ({ ...s, payDate: s.payDate ? s.payDate.split('-').reverse().join('/') : undefined });

  // Kirim rekap ke penitip lewat WhatsApp (tautan wa.me — pengguna menekan kirim sendiri).
  const sendWa = (s: Settlement) => {
    const phone = data.consignors.find(c => c.id === s.consignorId)?.phone;
    if (!phone) toast.error('Nomor WhatsApp penitip belum diisi — pilih kontaknya manual di WhatsApp.');
    window.open(waLink(phone, settlementMessage(waData(s), store.name, 'penitip')), '_blank', 'noopener');
  };

  // Aksi massal pada rekap yang dicentang: unduh PDF masing-masing & bayar dari dompet lapak masing-masing.
  const bulkPdf = async (list: Settlement[]) => {
    setBulkBusy('pdf');
    try { for (const s of list) await downloadSettlementPdf(s, store, consignorFor(s)); toast.success(`${list.length} PDF rekap diunduh.`); }
    catch { toast.error('Gagal membuat PDF.'); }
    setBulkBusy(null);
  };

  const bulkPay = (list: Settlement[], clear: () => void) => {
    const unpaid = list.filter(s => s.status === 'unpaid');
    if (unpaid.length === 0) { toast.error('Tidak ada rekap belum dibayar di antara yang dipilih.'); return; }
    setBulkPaying({ list: unpaid, skipped: list.length - unpaid.length, clear });
  };

  const downloadPdf = async (s: Settlement) => {
    setBusyId(s.id);
    try { await downloadSettlementPdf(s, store, consignorFor(s)); }
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
      {/* Saldo dompet tiap lapak — uang penjualan terkumpul di sini dan berkurang saat rekap dibayar. */}
      <div className="card p-3">
        <div className="flex items-center gap-2 mb-2">
          <Wallet size={14} style={{ color: 'var(--accent)' }} />
          <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Dompet Lapak</p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>— bertambah dari penjualan, berkurang saat rekap dibayar</p>
        </div>
        {data.stalls.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada lapak.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.stalls.map(st => (
              <div key={st.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--surface-2)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{st.name}</p>
                  <p className="text-sm font-bold tabular" style={{ color: st.balance > 0 ? '#059669' : 'var(--text-muted)' }}>{rupiah(st.balance)}</p>
                </div>
                {openJournal && <button onClick={() => openJournal(st.id)} className="btn-ghost text-[11px] flex-shrink-0" style={{ height: 28 }}>Jurnal</button>}
              </div>
            ))}
          </div>
        )}
      </div>

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
                {busyId === s.id ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />}
              </button>
            </Tooltip>
            <Tooltip label="Kirim rekap ke penitip lewat WhatsApp">
              <button onClick={() => sendWa(s)} className="btn-ghost p-2" style={{ color: '#059669' }}><MessageCircle size={13} /></button>
            </Tooltip>
            {s.status === 'unpaid' && can('edit') && (
              <Tooltip label="Bayar dari dompet lapak">
                <button onClick={() => setPayingDoc(s)} disabled={busyId === s.id} className="btn-ghost p-2" style={{ color: '#059669' }}><Banknote size={13} /></button>
              </Tooltip>
            )}
            {s.status === 'unpaid' && can('edit') && (
              <Tooltip label="Ubah rekap (periode/catatan)">
                <button onClick={() => setEditingDoc(s)} disabled={busyId === s.id} className="btn-ghost p-2"><Pencil size={13} /></button>
              </Tooltip>
            )}
            {s.status === 'unpaid' && can('delete') && (
              <Tooltip label="Hapus rekap (penjualan bisa direkap ulang)">
                <button onClick={() => cancel(s)} disabled={busyId === s.id} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
              </Tooltip>
            )}
            {s.status === 'paid' && can('edit') && (
              <Tooltip label="Batalkan pembayaran (uang kembali ke dompet lapak)">
                <button onClick={() => unpay(s)} disabled={busyId === s.id} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Undo2 size={13} /></button>
              </Tooltip>
            )}
          </>
        )}
        bulkActions={(sel, clear) => (
          <>
            <button onClick={() => bulkPdf(sel)} disabled={!!bulkBusy}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl flex-shrink-0 whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
              {bulkBusy === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />} PDF Rekap
            </button>
            {can('edit') && sel.some(s => s.status === 'unpaid') && (
              <button onClick={() => bulkPay(sel, clear)} disabled={!!bulkBusy}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl flex-shrink-0 whitespace-nowrap" style={{ background: '#059669', color: '#fff' }}>
                {bulkBusy === 'pay' ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />} Bayar ({sel.filter(s => s.status === 'unpaid').length})
              </button>
            )}
          </>
        )}
        exportCols={cols} exportTitle="DAFTAR REKAP BAGI HASIL PENITIP" exportFile="rekap-penitip"
      />

      {creating && (
        <CreateModal creds={creds} data={data} initial={creating} onClose={() => setCreating(null)}
          onCreated={async (doc) => { setCreating(null); await Promise.all([load(), reload()]); toast.success(`Rekap ${doc} dibuat. Lanjutkan dengan membayar dari dompet lapak.`); }} />
      )}
      {bulkPaying && (
        <BulkPayModal creds={creds} list={bulkPaying.list} skipped={bulkPaying.skipped} stalls={data.stalls} consignors={data.consignors}
          onClose={() => setBulkPaying(null)} onDone={async () => { bulkPaying.clear(); await Promise.all([load(), reload()]); }} />
      )}
      {payingDoc && (
        <PayModal creds={creds} settlement={payingDoc} consignor={consignorFor(payingDoc)} phone={data.consignors.find(c => c.id === payingDoc.consignorId)?.phone ?? ''}
          balance={data.stalls.find(x => x.id === payingDoc.stallId)?.balance ?? 0} storeName={store.name}
          onClose={() => setPayingDoc(null)} onPaid={async () => { await Promise.all([load(), reload()]); }}
          onPdf={async paid => downloadSettlementPdf(paid, store, consignorFor(paid))} />
      )}
      {editingDoc && (
        <CreateModal creds={creds} data={data} initial={{ stallId: editingDoc.stallId, consignorId: editingDoc.consignorId }} editing={editingDoc} onClose={() => setEditingDoc(null)}
          onCreated={async (doc) => { setEditingDoc(null); await Promise.all([load(), reload()]); toast.success(`Rekap ${doc} diubah.`); }} />
      )}
    </div>
  );
}

interface Preview { items: SettlementItem[]; total: number; count: number }

function CreateModal({ creds, data, initial, editing, onClose, onCreated }: {
  creds: string; data: SectionProps['data']; initial: { stallId: string; consignorId: string }; editing?: Settlement; onClose: () => void; onCreated: (docNumber: string) => Promise<void>;
}) {
  const [stallId, setStallId] = useState(initial.stallId);
  const [consignorId, setConsignorId] = useState(initial.consignorId);
  const [period, setPeriod] = useState<PeriodKey>(editing ? 'custom' : 'month');
  const [all, setAll] = useState(!editing && !!initial.stallId);   // dari "Belum direkap": ambil semua yang tersisa
  const [customFrom, setCustomFrom] = useState(editing?.periodFrom ?? todayKey());
  const [customTo, setCustomTo] = useState(editing?.periodTo ?? todayKey());
  const [note, setNote] = useState(editing?.note ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const range = all ? { from: '2000-01-01', to: todayKey() } : periodRange(period, customFrom, customTo);
  const ready = !!stallId && !!consignorId;

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    fetch(`${API}/api/consign/settlements/preview?stallId=${stallId}&consignorId=${consignorId}&from=${range.from}&to=${range.to}${editing ? `&settlementId=${editing.id}` : ''}`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<Preview> : null)
      .then(d => { if (alive) setPreview(d); });
    return () => { alive = false; };
  }, [creds, ready, stallId, consignorId, range.from, range.to, editing]);

  const create = async () => {
    setSaving(true); setError('');
    const r = editing
      ? await fetch(`${API}/api/consign/settlements/${editing.id}`, { method: 'PUT', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: range.from, to: range.to, note }) })
      : await fetch(`${API}/api/consign/settlements`, { method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ stallId, consignorId, from: range.from, to: range.to, note }) });
    const d = await r.json().catch(() => ({})) as { docNumber?: string; settlement?: { docNumber: string }; error?: string };
    const doc = d.docNumber ?? d.settlement?.docNumber;
    if (r.ok && doc) await onCreated(doc);
    else setError(d.error ?? (editing ? 'Gagal mengubah rekap.' : 'Gagal membuat rekap.'));
    setSaving(false);
  };

  const shown = ready ? preview : null;
  return (
    <ModalShell title={editing ? `Ubah Rekap ${editing.docNumber}` : 'Buat Rekap Bagi Hasil'} subtitle="Bagian penitip dari penjualan lapak" icon={<HandCoins size={17} />} onClose={onClose} size="modal-md"
      footer={<ModalFooter onClose={onClose} onSave={create} saving={saving} disabled={!shown || shown.count === 0} label={editing ? 'Simpan Perubahan' : 'Buat Rekap'} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Field label="Lapak" required>
            {editing ? <div className="input" style={{ background: 'var(--surface-2)' }}>{editing.stallName}</div> : (
              <SearchSelect value={stallId} onChange={setStallId} placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…"
                options={data.stalls.map(s => ({ value: s.id, label: s.name, sublabel: s.code }))} />
            )}
          </Field>
          <Field label="Penitip" required>
            {editing ? <div className="input" style={{ background: 'var(--surface-2)' }}>{editing.consignorName}</div> : (
              <SearchSelect value={consignorId} onChange={setConsignorId} placeholder="– Pilih penitip –" searchPlaceholder="Cari penitip…"
                options={data.consignors.map(c => ({ value: c.id, label: c.name, sublabel: c.code, imageUrl: c.logoUrl || undefined }))} />
            )}
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

// Bayar rekap: catat rincian pembayaran (tanggal, metode, rekening asal, no. referensi) — menjadi isi Bukti
// Pembayaran PDF dan pesan WhatsApp. Aplikasi hanya MENCATAT; transfer ke rekening penitip dilakukan sendiri.
function PayModal({ creds, settlement, consignor, phone, balance, storeName, onClose, onPaid, onPdf }: {
  creds: string; settlement: Settlement; consignor?: SettlementConsignor; phone: string; balance: number; storeName: string;
  onClose: () => void; onPaid: () => Promise<void>; onPdf: (s: Settlement) => Promise<void>;
}) {
  const toast = useToast();
  const [payDate, setPayDate] = useState(todayKey());
  const [method, setMethod] = useState<'transfer' | 'tunai'>('transfer');
  const [from, setFrom] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Settlement | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const short = balance < settlement.totalAmount;

  const pay = async () => {
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/consign/settlements/${settlement.id}/pay`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ payDate, method, from, reference, note, proofUrl }),
    });
    const d = await r.json().catch(() => ({})) as { settlement?: Settlement; error?: string };
    if (r.ok && d.settlement) { setDone(d.settlement); await onPaid(); }
    else setError(d.error ?? 'Gagal membayar rekap.');
    setSaving(false);
  };

  const sendWa = () => {
    if (!done) return;
    if (!phone) toast.error('Nomor WhatsApp penitip belum diisi — pilih kontaknya manual di WhatsApp.');
    window.open(waLink(phone, settlementMessage({ ...done, payDate: done.payDate ? done.payDate.split('-').reverse().join('/') : undefined }, storeName, 'penitip')), '_blank', 'noopener');
  };
  const pdf = async () => {
    if (!done) return;
    setPdfBusy(true);
    try { await onPdf(done); } catch { toast.error('Gagal membuat PDF.'); }
    setPdfBusy(false);
  };

  if (done) {
    return (
      <ModalShell title="Pembayaran Tercatat" subtitle={`${done.docNumber} · ${done.consignorName}`} icon={<CheckCircle2 size={17} />} onClose={onClose}
        footer={<button onClick={onClose} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Selesai</button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Pembayaran <strong>{rupiah(done.totalAmount)}</strong> ke {done.consignorName} sudah dicatat. Kirim nota ke penitip sekarang?
          </p>
          <button onClick={sendWa} className="btn-ghost text-sm" style={{ justifyContent: 'center', padding: '10px 0', color: '#059669' }}>
            <MessageCircle size={15} /> Kirim Nota lewat WhatsApp
          </button>
          <button onClick={pdf} disabled={pdfBusy} className="btn-ghost text-sm" style={{ justifyContent: 'center', padding: '10px 0' }}>
            {pdfBusy ? <Loader2 size={15} className="animate-spin" /> : <PdfIcon size={15} />} Unduh Bukti Pembayaran (PDF)
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Bayar Rekap ke Penitip" subtitle={`${settlement.docNumber} · ${settlement.stallName}`} icon={<Banknote size={17} />} onClose={onClose}
      footer={<ModalFooter onClose={onClose} onSave={pay} saving={saving} disabled={!payDate || uploading} label={`Catat Pembayaran ${rupiah(settlement.totalAmount)}`} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card p-3" style={{ background: 'var(--surface-2)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Bayar kepada</p>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{settlement.consignorName}</p>
          {consignor?.bankName || consignor?.bankAccount ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{[consignor.bankName, consignor.bankAccount, consignor.bankHolder ? `a.n. ${consignor.bankHolder}` : ''].filter(Boolean).join(' · ')}</p>
          ) : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Rekening penitip belum diisi di data Penitip.</p>}
          <p className="text-xs mt-1.5 tabular" style={{ color: short ? 'var(--danger)' : 'var(--text-muted)' }}>
            Saldo dompet {settlement.stallName}: {rupiah(balance)} → {rupiah(balance - settlement.totalAmount)}{short ? ' (tidak cukup)' : ''}
          </p>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Ini hanya mencatat pembayaran. Transfer/penyerahan uang ke penitip Anda lakukan sendiri, lalu isi rinciannya di bawah untuk bukti pembayaran.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tanggal bayar" required><input className="input" type="date" value={payDate} max={todayKey()} onChange={e => setPayDate(e.target.value)} /></Field>
          <Field label="Metode">
            <div className="flex rounded-xl overflow-hidden border text-xs font-bold" style={{ borderColor: 'var(--border)' }}>
              {(['transfer', 'tunai'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMethod(m)} className="flex-1 px-3 py-2.5"
                  style={method === m ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                  {m === 'transfer' ? 'Transfer' : 'Tunai'}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <PayFromField creds={creds} method={method} value={from} onChange={setFrom} />
        <Field label="No. referensi / bukti transfer (opsional)">
          <input className="input" value={reference} maxLength={80} onChange={e => setReference(e.target.value)} placeholder="cth: 2610120012345" />
        </Field>
        <ProofField creds={creds} url={proofUrl} uploading={uploading} setUploading={setUploading} onChange={setProofUrl} />
        <Field label="Catatan pembayaran (opsional)">
          <input className="input" value={note} maxLength={200} onChange={e => setNote(e.target.value)} />
        </Field>
        <ErrorBox message={error} />
      </div>
    </ModalShell>
  );
}

// Bayar beberapa rekap sekaligus: tiap rekap menampilkan penerima (rekening, no. rekening, atas nama) dan
// nominalnya supaya jelas siapa yang harus ditransfer. Rincian pembayaran (tanggal, metode, dst) berlaku untuk semua.
function BulkPayModal({ creds, list, skipped, stalls, consignors, onClose, onDone }: {
  creds: string; list: Settlement[]; skipped: number; stalls: SectionProps['data']['stalls']; consignors: SectionProps['data']['consignors'];
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [payDate, setPayDate] = useState(todayKey());
  const [method, setMethod] = useState<'transfer' | 'tunai'>('transfer');
  const [from, setFrom] = useState('');
  const [note, setNote] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: string[]; failed: { doc: string; error: string }[] } | null>(null);

  const total = list.reduce((a, s) => a + s.totalAmount, 0);
  const perStall = new Map<string, number>();
  for (const s of list) perStall.set(s.stallId, (perStall.get(s.stallId) ?? 0) + s.totalAmount);
  const walletRows = [...perStall].map(([id, need]) => {
    const st = stalls.find(x => x.id === id);
    return { id, name: st?.name ?? '?', balance: st?.balance ?? 0, need };
  });
  const anyShort = walletRows.some(w => w.balance < w.need);

  const run = async () => {
    setSaving(true);
    const ok: string[] = []; const failed: { doc: string; error: string }[] = [];
    for (const s of list) {
      const r = await fetch(`${API}/api/consign/settlements/${s.id}/pay`, {
        method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ payDate, method, from, note, proofUrl }),
      });
      if (r.ok) ok.push(s.docNumber);
      else failed.push({ doc: s.docNumber, error: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membayar.' });
    }
    if (ok.length > 0) await onDone();
    setResult({ ok, failed });
    setSaving(false);
  };

  if (result) {
    return (
      <ModalShell title="Hasil Pembayaran" subtitle={`${result.ok.length} berhasil · ${result.failed.length} gagal`} icon={<CheckCircle2 size={17} />} onClose={onClose}
        footer={<button onClick={onClose} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Selesai</button>}>
        <div className="space-y-2">
          {result.ok.length > 0 && <p className="text-sm" style={{ color: '#059669' }}>Tercatat dibayar: {result.ok.join(', ')}</p>}
          {result.failed.map(f => (
            <p key={f.doc} className="text-sm" style={{ color: 'var(--danger)' }}><strong>{f.doc}</strong> — {f.error}</p>
          ))}
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title={`Bayar ${list.length} Rekap ke Penitip`} subtitle={`Total ${rupiah(total)}`} icon={<Banknote size={17} />} onClose={onClose} size="modal-md"
      footer={<ModalFooter onClose={onClose} onSave={run} saving={saving} disabled={!payDate || uploading} label={`Catat Pembayaran ${rupiah(total)}`} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
          {list.map((s, idx) => {
            const c = consignors.find(x => x.id === s.consignorId);
            const hasBank = !!(c?.bankName || c?.bankAccount);
            return (
              <div key={s.id} className="px-3 py-2.5" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.consignorName}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{s.docNumber} · {s.stallName}</p>
                  </div>
                  <p className="text-sm font-bold tabular flex-shrink-0" style={{ color: 'var(--accent)' }}>{rupiah(s.totalAmount)}</p>
                </div>
                {hasBank ? (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {[c?.bankName, c?.bankAccount, c?.bankHolder ? `a.n. ${c.bankHolder}` : ''].filter(Boolean).join(' · ')}
                  </p>
                ) : <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>Rekening penitip belum diisi di data Penitip.</p>}
              </div>
            );
          })}
        </div>

        <div className="card p-3 space-y-1" style={{ background: 'var(--surface-2)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Saldo dompet lapak</p>
          {walletRows.map(w => (
            <p key={w.id} className="text-xs tabular" style={{ color: w.balance < w.need ? 'var(--danger)' : 'var(--text-secondary)' }}>
              {w.name}: {rupiah(w.balance)} → {rupiah(w.balance - w.need)}{w.balance < w.need ? ' (tidak cukup — sebagian rekap akan gagal)' : ''}
            </p>
          ))}
        </div>
        {skipped > 0 && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{skipped} rekap yang sudah dibayar dilewati.</p>}
        <p className="text-[11px]" style={{ color: anyShort ? 'var(--danger)' : 'var(--text-muted)' }}>
          Ini hanya mencatat pembayaran. Transfer/penyerahan uang ke tiap penitip Anda lakukan sendiri; rincian di bawah berlaku untuk semua rekap ini.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tanggal bayar" required><input className="input" type="date" value={payDate} max={todayKey()} onChange={e => setPayDate(e.target.value)} /></Field>
          <Field label="Metode">
            <div className="flex rounded-xl overflow-hidden border text-xs font-bold" style={{ borderColor: 'var(--border)' }}>
              {(['transfer', 'tunai'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMethod(m)} className="flex-1 px-3 py-2.5"
                  style={method === m ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                  {m === 'transfer' ? 'Transfer' : 'Tunai'}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <PayFromField creds={creds} method={method} value={from} onChange={setFrom} />
        <ProofField creds={creds} url={proofUrl} uploading={uploading} setUploading={setUploading} onChange={setProofUrl} hint="Foto yang sama dipakai untuk semua rekap ini." />
        <Field label="Catatan pembayaran (opsional)">
          <input className="input" value={note} maxLength={200} onChange={e => setNote(e.target.value)} />
        </Field>
      </div>
    </ModalShell>
  );
}

// Pilih sumber dana pembayaran dari dompet toko (tunai → dompet Tunai, transfer → Bank/E-Wallet), atau ketik manual.
// Hanya untuk keterangan di bukti pembayaran — saldo yang berkurang tetap dompet lapak.
function PayFromField({ creds, method, value, onChange }: { creds: string; method: 'transfer' | 'tunai'; value: string; onChange: (v: string) => void }) {
  const wallets = useWallets(creds);
  const MANUAL = '__manual';
  const names = wallets.filter(w => w.isActive && (method === 'tunai' ? w.type === 'cash' : w.type !== 'cash')).map(w => w.name);
  const [manual, setManual] = useState(false);
  const isManual = manual || (!!value && !names.includes(value));
  return (
    <Field label={method === 'transfer' ? 'Dari rekening / dompet (opsional)' : 'Dari kas (opsional)'}>
      <SearchSelect value={isManual ? MANUAL : value}
        onChange={v => { if (v === MANUAL) { setManual(true); onChange(''); } else { setManual(false); onChange(v); } }}
        placeholder={method === 'transfer' ? '– Pilih rekening / dompet –' : '– Pilih kas –'} searchPlaceholder="Cari dompet…"
        options={[{ value: '', label: '– Tidak diisi –' }, ...names.map(n => ({ value: n, label: n })), { value: MANUAL, label: 'Lainnya (ketik manual)' }]} />
      {isManual && (
        <input className="input mt-2" value={value} maxLength={120} onChange={e => onChange(e.target.value)}
          placeholder={method === 'transfer' ? 'cth: BCA 1234567890 a.n. Toko' : 'cth: Kas toko'} />
      )}
    </Field>
  );
}

// Foto bukti transfer/pembayaran: pilih dari galeri atau langsung ambil gambar dengan kamera (HP).
function ProofField({ creds, url, uploading, setUploading, onChange, hint }: {
  creds: string; url: string; uploading: boolean; setUploading: (b: boolean) => void; onChange: (u: string) => void; hint?: string;
}) {
  const toast = useToast();
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try { onChange(await uploadImage(f, creds, 1400)); }
    catch { toast.error('Upload foto bukti gagal, coba lagi.'); }
    setUploading(false);
  };
  const btn = 'btn-ghost text-xs flex-1 justify-center cursor-pointer';
  return (
    <Field label="Foto bukti transfer (opsional)">
      {url ? (
        <div className="flex items-center gap-3 p-2 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Bukti pembayaran" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs"><ExternalLink size={12} /> Lihat</a>
          <button type="button" onClick={() => onChange('')} className="btn-ghost text-xs ml-auto" style={{ color: 'var(--danger)' }}><X size={12} /> Hapus</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <label className={btn} style={{ height: 40, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} Pilih foto
            <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <label className={btn} style={{ height: 40, opacity: uploading ? 0.6 : 1 }}>
            <Camera size={14} /> Ambil gambar
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={uploading} onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      )}
      {hint && <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </Field>
  );
}
