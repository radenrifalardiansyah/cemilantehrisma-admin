'use client';

import { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, AlertTriangle, Undo2, Loader2, X, Plus } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import FilterSelect from '@/components/FilterSelect';
import SearchSelect from '@/components/SearchSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { periodRange, type PeriodKey } from '@/lib/period';
import PeriodBar from './PeriodBar';
import DataList, { DetailPanel, type ExportCol } from './DataList';
import {
  API, HEADER_BTN_H, Badge, Field, ModalShell, ModalFooter, ErrorBox, rupiah, qtyText, effectiveFor, type SectionProps,
} from './shared';

type Kind = 'opname' | 'damage' | 'lost' | 'expired' | 'other';
type Bearer = 'toko' | 'penitip' | 'none';
interface AdjItem { productId: string; productName: string; unit: string; consignorName: string; before: number; after: number; delta: number; compensation: number }
interface Adjustment {
  id: string; docNumber: string; kind: Kind; stallId: string; stallName: string; bearer: Bearer; docDate: string;
  items: AdjItem[]; totalDelta: number; totalCompensation: number; note: string; createdBy: string;
}
interface Result { adjustments: Adjustment[]; hasAny: boolean }

const KIND_LABEL: Record<Kind, string> = { opname: 'Opname', damage: 'Rusak', lost: 'Hilang', expired: 'Kadaluarsa', other: 'Lainnya' };
const BEARER_LABEL: Record<Bearer, string> = { toko: 'Ditanggung toko', penitip: 'Ditanggung penitip', none: '' };
const todayKey = () => new Date().toLocaleDateString('en-CA');

async function fetchAdjustments(creds: string, from: string, to: string): Promise<Result> {
  const r = await fetch(`${API}/api/consign/adjustments?from=${from}&to=${to}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as Result : { adjustments: [], hasAny: false };
}

// Stok opname & penyesuaian stok titipan (rusak/hilang/kadaluarsa/selisih hitung). Kerugian bisa
// ditanggung toko (kompensasi ke penitip masuk rekap) atau penitip (tanpa pengaruh uang).
export default function AdjustmentsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [result, setResult] = useState<Result | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const { from, to } = periodRange(period, customFrom, customTo);
  const [stallFilter, setStallFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [modal, setModal] = useState<Kind | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const load = useCallback(async () => { setResult(await fetchAdjustments(creds, from, to)); }, [creds, from, to]);
  useEffect(() => {
    let alive = true;
    fetchAdjustments(creds, from, to).then(d => { if (alive) setResult(d); });
    return () => { alive = false; };
  }, [creds, from, to]);

  const voidDoc = async (a: Adjustment) => {
    if (!await confirm({ message: `Batalkan ${a.docNumber}? Stok dikembalikan seperti sebelum dokumen ini${a.totalCompensation > 0 ? ' dan kompensasi ke penitip dihapus' : ''}.`, danger: true })) return;
    setVoidingId(a.id);
    const r = await fetch(`${API}/api/consign/adjustments/${a.id}`, { method: 'DELETE', headers });
    if (r.ok) { await Promise.all([reload(), load()]); toast.success(`${a.docNumber} dibatalkan.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membatalkan dokumen.');
    setVoidingId(null);
  };

  if (result === null) return <PageLoader />;

  const items = result.adjustments
    .filter(a => !stallFilter || a.stallId === stallFilter)
    .filter(a => !kindFilter || a.kind === kindFilter);
  const summary = (a: Adjustment) => a.items.map(i => `${i.productName} ${i.delta > 0 ? '+' : ''}${qtyText(i.delta)}`).join(', ');

  const cols: ExportCol<Adjustment>[] = [
    { header: 'No. Dokumen', width: '13%', bold: true, value: a => a.docNumber },
    { header: 'Jenis', width: '8%', value: a => KIND_LABEL[a.kind] },
    { header: 'Tanggal', width: '9%', value: a => a.docDate },
    { header: 'Lapak', width: '10%', value: a => a.stallName },
    { header: 'Perubahan Stok', width: '30%', value: a => summary(a) },
    { header: 'Ditanggung', width: '11%', value: a => BEARER_LABEL[a.bearer] || '-' },
    { header: 'Kompensasi', width: '10%', align: 'right', value: a => rupiah(a.totalCompensation) },
    { header: 'Dibuat Oleh', width: '9%', value: a => a.createdBy || '-' },
  ];

  return (
    <div className="space-y-4">
      {result.hasAny && <PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} />}
      <DataList<Adjustment>
        creds={creds} items={items} totalCount={result.hasAny ? Math.max(result.adjustments.length, 1) : 0} getId={a => a.id} noun="dokumen"
        searchText={a => `${a.docNumber} ${a.stallName} ${KIND_LABEL[a.kind]} ${a.items.map(i => `${i.productName} ${i.consignorName}`).join(' ')}`}
        searchPlaceholder="Cari no. dokumen, lapak, atau produk…" viewKey="consign-adjustments" resetKey={`${stallFilter}|${kindFilter}`}
        addLabel={can('create') ? 'Opname Stok' : undefined} onAdd={can('create') ? () => setModal('opname') : undefined}
        emptyHint="Opname = hitung stok fisik lalu samakan dengan sistem. Selisih, barang rusak, hilang, atau kadaluarsa dicatat di sini."
        filters={(
          <>
            <FilterSelect value={kindFilter} onChange={setKindFilter}
              options={[{ value: '', label: 'Semua jenis' }, ...(Object.keys(KIND_LABEL) as Kind[]).map(k => ({ value: k, label: KIND_LABEL[k] }))]} />
            <FilterSelect value={stallFilter} onChange={setStallFilter} searchPlaceholder="Cari lapak…"
              options={[{ value: '', label: 'Semua lapak' }, ...data.stalls.map(s => ({ value: s.id, label: s.name }))]} />
          </>
        )}
        headerExtra={can('create') ? (
          <button onClick={() => setModal('damage')} className="btn-ghost text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
            <AlertTriangle size={13} /> <span className="hidden sm:inline">Catat Kerugian</span>
          </button>
        ) : undefined}
        renderBody={a => (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{a.docNumber}</p>
              <Badge tone={a.kind === 'opname' ? 'accent' : 'danger'}>{KIND_LABEL[a.kind]}</Badge>
              <Badge>{a.stallName}</Badge>
              {a.bearer !== 'none' && <Badge>{BEARER_LABEL[a.bearer]}</Badge>}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.docDate} · {a.createdBy} · total {a.totalDelta > 0 ? '+' : ''}{qtyText(a.totalDelta)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{summary(a)}</p>
            {a.totalCompensation > 0 && <p className="text-[11px] mt-0.5 font-semibold" style={{ color: 'var(--danger)' }}>Kompensasi ke penitip {rupiah(a.totalCompensation)}</p>}
            {a.note && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.note}</p>}
          </>
        )}
        renderDetail={a => (
          <DetailPanel fields={[
            { label: 'No. Dokumen', value: a.docNumber }, { label: 'Jenis', value: KIND_LABEL[a.kind] },
            { label: 'Tanggal', value: a.docDate }, { label: 'Lapak', value: a.stallName },
            { label: 'Ditanggung', value: BEARER_LABEL[a.bearer] }, { label: 'Dibuat Oleh', value: a.createdBy },
            { label: 'Kompensasi ke Penitip', value: a.totalCompensation > 0 ? rupiah(a.totalCompensation) : '' },
            ...(a.note ? [{ label: 'Catatan', value: a.note, wide: true }] : []),
          ]}>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Perubahan stok</p>
              {a.items.map(i => (
                <div key={i.productId} className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{i.productName} <span style={{ color: 'var(--text-muted)' }}>· {i.consignorName}</span></span>
                  <span style={{ color: i.delta < 0 ? 'var(--danger)' : '#059669' }}>
                    {qtyText(i.before)} → {qtyText(i.after)} ({i.delta > 0 ? '+' : ''}{qtyText(i.delta)} {i.unit}){i.compensation > 0 ? ` · ${rupiah(i.compensation)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </DetailPanel>
        )}
        actions={a => can('delete') ? (
          <Tooltip label="Batalkan dokumen">
            <button onClick={() => voidDoc(a)} disabled={voidingId === a.id} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
              {voidingId === a.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
            </button>
          </Tooltip>
        ) : null}
        exportCols={cols} exportTitle="DOKUMEN OPNAME & PENYESUAIAN STOK TITIPAN" exportFile="opname-titip-jual"
      />

      {modal && (
        <AdjustmentModal creds={creds} data={data} initialKind={modal} onClose={() => setModal(null)}
          onDone={async (docNumber) => { setModal(null); await Promise.all([reload(), load()]); toast.success(`Penyesuaian stok dicatat: ${docNumber}`); }} />
      )}
    </div>
  );
}

interface LossRow { productId: string; qty: string }

function AdjustmentModal({ creds, data, initialKind, onClose, onDone }: {
  creds: string; data: SectionProps['data']; initialKind: Kind; onClose: () => void; onDone: (docNumber: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [stallId, setStallId] = useState('');
  const [bearer, setBearer] = useState<Bearer>('toko');
  const [note, setNote] = useState('');
  const [consignorFilter, setConsignorFilter] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [lossRows, setLossRows] = useState<LossRow[]>([{ productId: '', qty: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const productById = new Map(data.products.map(p => [p.id, p]));
  const consignorById = new Map(data.consignors.map(c => [c.id, c]));
  const stallItems = data.stallItems.filter(i => i.stallId === stallId && productById.has(i.productId));
  const info = (productId: string) => {
    const item = stallItems.find(i => i.productId === productId);
    const p = productById.get(productId);
    if (!item || !p) return null;
    const share = effectiveFor(p, consignorById.get(p.consignorId), item).share;
    return { p, stock: item.stockQty, share: share ? share.consignor : null, consignorName: consignorById.get(p.consignorId)?.name ?? '' };
  };

  // Hitungan efektif per produk: opname → selisih terhadap stok; kerugian → -qty.
  const deltas: { productId: string; delta: number }[] = kind === 'opname'
    ? Object.entries(counts).filter(([, v]) => v !== '' && Number.isFinite(Number(v))).flatMap(([productId, v]) => {
        const i = info(productId); return i ? [{ productId, delta: Number(v) - i.stock }] : [];
      })
    : lossRows.filter(r => r.productId && Number(r.qty) > 0).map(r => ({ productId: r.productId, delta: -Number(r.qty) }));
  const hasLoss = deltas.some(d => d.delta < 0);
  const compensation = bearer === 'toko'
    ? deltas.filter(d => d.delta < 0).reduce((a, d) => a + -d.delta * (info(d.productId)?.share ?? 0), 0) : 0;
  const noShare = bearer === 'toko' && deltas.some(d => d.delta < 0 && info(d.productId)?.share === null);
  const changed = deltas.filter(d => d.delta !== 0);
  const overdrawn = kind !== 'opname' && lossRows.some(r => { const i = r.productId ? info(r.productId) : null; return !!i && Number(r.qty) > i.stock; });
  const valid = !!stallId && changed.length > 0 && !noShare && !overdrawn && (kind === 'opname' || bearer !== 'none');

  const save = async () => {
    setSaving(true); setError('');
    const items = kind === 'opname'
      ? Object.entries(counts).filter(([, v]) => v !== '').map(([productId, v]) => ({ productId, counted: Number(v) }))
      : lossRows.filter(r => r.productId).map(r => ({ productId: r.productId, qty: Number(r.qty) }));
    const r = await fetch(`${API}/api/consign/adjustments`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, stallId, bearer: hasLoss ? bearer : 'none', note, items }),
    });
    const d = await r.json().catch(() => ({})) as { docNumber?: string; error?: string };
    if (r.ok && d.docNumber) await onDone(d.docNumber);
    else setError(d.error ?? 'Gagal menyimpan penyesuaian.');
    setSaving(false);
  };

  const shownItems = stallItems.filter(i => !consignorFilter || productById.get(i.productId)?.consignorId === consignorFilter)
    .sort((a, b) => (productById.get(a.productId)?.name ?? '').localeCompare(productById.get(b.productId)?.name ?? '', 'id'));
  const consignorsHere = [...new Set(stallItems.map(i => productById.get(i.productId)?.consignorId).filter((x): x is string => !!x))];

  return (
    <ModalShell title={kind === 'opname' ? 'Opname Stok Titipan' : 'Catat Kerugian Stok'} subtitle="Samakan stok sistem dengan kondisi fisik"
      icon={kind === 'opname' ? <ClipboardCheck size={17} /> : <AlertTriangle size={17} />} onClose={onClose} size="modal-md"
      footer={<ModalFooter onClose={onClose} onSave={save} saving={saving} disabled={!valid} label={kind === 'opname' ? 'Simpan Opname' : 'Simpan Kerugian'} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="inline-flex max-w-full rounded-xl overflow-x-auto no-scrollbar border self-start" style={{ borderColor: 'var(--border)' }}>
          {(Object.keys(KIND_LABEL) as Kind[]).map(k => (
            <button key={k} type="button" onClick={() => setKind(k)} className="px-3.5 py-2 text-xs font-bold whitespace-nowrap flex-shrink-0"
              style={kind === k ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          {kind === 'opname'
            ? 'Isi hitungan fisik tiap produk yang dihitung (kosongkan yang tidak dihitung). Selisih minus mengurangi stok, selisih plus menambah stok.'
            : `Catat barang ${KIND_LABEL[kind].toLowerCase()}: stok di lapak berkurang sesuai jumlah yang dicatat.`}
        </p>

        <Field label="Lapak" required>
          <SearchSelect value={stallId} onChange={v => { setStallId(v); setCounts({}); setLossRows([{ productId: '', qty: '' }]); setConsignorFilter(''); }}
            options={data.stalls.map(s => ({ value: s.id, label: s.name, sublabel: s.code }))} placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…" />
        </Field>

        {stallId && kind === 'opname' && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="field-label" style={{ marginBottom: 0 }}>Hitungan Fisik</label>
              {consignorsHere.length > 1 && (
                <div className="w-44">
                  <FilterSelect value={consignorFilter} onChange={setConsignorFilter} searchPlaceholder="Cari penitip…"
                    options={[{ value: '', label: 'Semua penitip' }, ...consignorsHere.map(id => ({ value: id, label: consignorById.get(id)?.name ?? id }))]} />
                </div>
              )}
            </div>
            {shownItems.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada produk titipan terdaftar di lapak ini.</p>
            ) : shownItems.map(i => {
              const inf = info(i.productId)!;
              const v = counts[i.productId] ?? '';
              const diff = v === '' ? null : Number(v) - inf.stock;
              return (
                <div key={i.productId} className="flex items-center gap-2 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{inf.p.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{inf.consignorName} · sistem {qtyText(inf.stock)} {inf.p.unit}</p>
                  </div>
                  <input className="input" style={{ width: 90, flexShrink: 0 }} type="number" min={0} step="any" inputMode="decimal" placeholder="hitung"
                    value={v} onChange={e => setCounts(c => ({ ...c, [i.productId]: e.target.value }))} />
                  <span className="text-xs font-bold tabular w-12 text-right flex-shrink-0" style={{ color: diff === null || diff === 0 ? 'var(--text-muted)' : diff < 0 ? 'var(--danger)' : '#059669' }}>
                    {diff === null ? '' : diff === 0 ? 'sama' : `${diff > 0 ? '+' : ''}${qtyText(diff)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {stallId && kind !== 'opname' && (
          <div>
            <label className="field-label" style={{ marginBottom: 0 }}>Produk {KIND_LABEL[kind]}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
              {lossRows.map((r, idx) => {
                const inf = r.productId ? info(r.productId) : null;
                const q = Number(r.qty) || 0;
                return (
                  <div key={idx} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <SearchSelect value={r.productId} onChange={v => setLossRows(rs => rs.map((x, i) => i === idx ? { ...x, productId: v } : x))}
                          options={stallItems.filter(i => i.productId === r.productId || !lossRows.some((o, oi) => oi !== idx && o.productId === i.productId))
                            .map(i => ({ value: i.productId, label: productById.get(i.productId)?.name ?? '', sublabel: `${consignorById.get(productById.get(i.productId)?.consignorId ?? '')?.name ?? ''} · stok ${qtyText(i.stockQty)}` }))}
                          placeholder="– Produk –" searchPlaceholder="Cari produk…" />
                      </div>
                      <button onClick={() => setLossRows(rs => rs.filter((_, i) => i !== idx))} disabled={lossRows.length === 1} className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}><X size={14} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="field-label" style={{ fontSize: 11 }}>Qty{inf ? ` (${inf.p.unit})` : ''}</label>
                        <input className={`input${inf && q > inf.stock ? ' input-error' : ''}`} type="number" min={0} step="any" inputMode="decimal" placeholder="0"
                          value={r.qty} onChange={e => setLossRows(rs => rs.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))} />
                      </div>
                      <div>
                        <label className="field-label" style={{ fontSize: 11 }}>Stok di lapak</label>
                        <div className="input flex items-center justify-between" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                          <span className="tabular">{inf ? qtyText(inf.stock) : '–'}</span>
                          {inf && q > 0 && <span className="text-[11px] tabular" style={{ color: q > inf.stock ? 'var(--danger)' : 'var(--text-muted)' }}>→ {qtyText(inf.stock - q)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setLossRows(rs => [...rs, { productId: '', qty: '' }])} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
              <Plus size={12} /> Tambah Baris Produk
            </button>
          </div>
        )}

        {stallId && (kind !== 'opname' || hasLoss) && (
          <div>
            <p className="field-label">Kerugian ditanggung oleh</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([['toko', 'Toko', 'Toko tetap berutang bagian penitip untuk barang ini (masuk rekap sebagai kompensasi).'],
                 ['penitip', 'Penitip', 'Tidak ada pembayaran untuk barang ini — risiko ditanggung penitip.']] as const).map(([b, label, desc]) => (
                <button key={b} type="button" onClick={() => setBearer(b)} className="text-left p-3 rounded-xl transition-all"
                  style={{ border: `1.5px solid ${bearer === b ? 'var(--accent)' : 'var(--border-2)'}`, background: bearer === b ? 'var(--accent-bg)' : 'transparent' }}>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{label}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                </button>
              ))}
            </div>
            {noShare && <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>Ada produk yang skema bagi hasilnya belum ditentukan — kompensasi toko tidak bisa dihitung.</p>}
          </div>
        )}

        <Field label="Catatan">
          <input className="input" value={note} maxLength={200} placeholder="Catatan tambahan (opsional)" onChange={e => setNote(e.target.value)} />
        </Field>

        {changed.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {changed.length} produk berubah · {qtyText(changed.reduce((a, d) => a + d.delta, 0))} pcs
            </span>
            {bearer === 'toko' && compensation > 0 && <span className="text-sm font-extrabold tabular" style={{ color: 'var(--danger)' }}>Kompensasi {rupiah(compensation)}</span>}
          </div>
        )}
        <ErrorBox message={error} />
      </div>
    </ModalShell>
  );
}
