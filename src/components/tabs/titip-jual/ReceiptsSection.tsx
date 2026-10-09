'use client';

import { useState, useEffect, useCallback } from 'react';
import { PackagePlus, PackageMinus, X, Loader2, Undo2, Plus } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import FilterSelect from '@/components/FilterSelect';
import SearchSelect from '@/components/SearchSelect';
import { periodRange, type PeriodKey } from '@/lib/period';
import PeriodBar from './PeriodBar';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import DataList, { DetailPanel, type ExportCol } from './DataList';
import {
  API, HEADER_BTN_H, Badge, Field, ModalShell, ModalFooter, ErrorBox, qtyText, rupiah, effectiveFor,
  type SectionProps, type Receipt,
} from './shared';

interface Line { productId: string; qty: string }
interface Form { kind: 'in' | 'return'; consignorId: string; stallId: string; docDate: string; note: string; lines: Line[] }

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface ReceiptsResult { receipts: Receipt[]; hasAny: boolean }

async function fetchReceipts(creds: string, from: string, to: string): Promise<ReceiptsResult> {
  const r = await fetch(`${API}/api/consign/receipts?from=${from}&to=${to}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as ReceiptsResult : { receipts: [], hasAny: false };
}

export default function ReceiptsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [result, setResult] = useState<ReceiptsResult | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const { from, to } = periodRange(period, customFrom, customTo);
  const [consignorFilter, setConsignorFilter] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [editing, setEditing] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadReceipts = useCallback(async () => { setResult(await fetchReceipts(creds, from, to)); }, [creds, from, to]);
  useEffect(() => {
    let alive = true;
    fetchReceipts(creds, from, to).then(d => { if (alive) setResult(d); });
    return () => { alive = false; };
  }, [creds, from, to]);

  const open = (kind: 'in' | 'return') => {
    setError('');
    setEditing({ kind, consignorId: consignorFilter, stallId: stallFilter, docDate: todayKey(), note: '', lines: [{ productId: '', qty: '' }] });
  };

  const consignorProducts = editing ? data.products.filter(p => p.consignorId === editing.consignorId && (p.isActive || editing.kind === 'return')) : [];
  const stockOf = (productId: string, stallId: string) =>
    data.stallItems.find(i => i.productId === productId && i.stallId === stallId)?.stockQty ?? 0;

  // Info tiap baris (produk, stok di lapak terpilih, bagian penitip per unit) untuk tampilan & validasi.
  const consignorOf = editing ? data.consignors.find(c => c.id === editing.consignorId) : undefined;
  const lineInfo = (l: Line) => {
    const p = consignorProducts.find(x => x.id === l.productId);
    if (!p || !editing) return null;
    const item = data.stallItems.find(i => i.productId === p.id && i.stallId === editing.stallId);
    const share = effectiveFor(p, consignorOf, item).share;
    return { unit: p.unit, stock: item?.stockQty ?? 0, qty: Number(l.qty) || 0, consignorShare: share ? share.consignor : null };
  };
  const infos = editing ? editing.lines.map(lineInfo) : [];
  const totalQty = infos.reduce((a, i) => a + (i?.qty ?? 0), 0);
  const totalValue = infos.reduce((a, i) => a + (i && i.consignorShare !== null ? i.qty * i.consignorShare : 0), 0);

  const setLine = (idx: number, patch: Partial<Line>) =>
    setEditing(e => e && ({ ...e, lines: e.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    const body = {
      kind: editing.kind, consignorId: editing.consignorId, stallId: editing.stallId, docDate: editing.docDate, note: editing.note,
      items: editing.lines.filter(l => l.productId).map(l => ({ productId: l.productId, qty: Number(l.qty) })),
    };
    const r = await fetch(`${API}/api/consign/receipts`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (r.ok) {
      const { docNumber } = await r.json() as { docNumber: string };
      await Promise.all([reload(), loadReceipts()]);
      setEditing(null);
      toast.success(`${editing.kind === 'in' ? 'Barang berhasil diterima' : 'Retur berhasil dicatat'}: ${docNumber}`);
    } else {
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menyimpan dokumen.';
      setError(msg); toast.error(msg);
    }
    setSaving(false);
  };

  const voidDoc = async (rc: Receipt) => {
    if (!await confirm({ message: `Batalkan ${rc.docNumber}? Stok akan dikembalikan seperti sebelum dokumen ini.`, danger: true })) return;
    setVoidingId(rc.id);
    const r = await fetch(`${API}/api/consign/receipts/${rc.id}`, { method: 'DELETE', headers });
    if (r.ok) { await Promise.all([reload(), loadReceipts()]); toast.success(`${rc.docNumber} berhasil dibatalkan.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membatalkan dokumen.');
    setVoidingId(null);
  };

  const valid = !!editing && !!editing.consignorId && !!editing.stallId
    && editing.lines.some(l => l.productId && Number(l.qty) > 0)
    && editing.lines.every(l => !l.productId || Number(l.qty) > 0)
    && (editing.kind !== 'return' || editing.lines.every(l => { const i = lineInfo(l); return !i || i.qty <= i.stock; }));

  if (result === null) return <PageLoader />;
  const receipts = result.receipts;

  const items = receipts
    .filter(r => !consignorFilter || r.consignorId === consignorFilter)
    .filter(r => !stallFilter || r.stallId === stallFilter)
    .filter(r => !kindFilter || r.kind === kindFilter);

  const cols: ExportCol<Receipt>[] = [
    { header: 'No. Dokumen', width: '14%', bold: true, value: r => r.docNumber },
    { header: 'Jenis', width: '8%', value: r => r.kind === 'in' ? 'Terima' : 'Retur' },
    { header: 'Tanggal', width: '10%', value: r => r.docDate },
    { header: 'Penitip', width: '14%', value: r => r.consignorName },
    { header: 'Lapak', width: '10%', value: r => r.stallName },
    { header: 'Barang', width: '28%', value: r => r.items.map(i => `${i.productName} x${qtyText(i.qty)}`).join(', ') },
    { header: 'Total Qty', width: '8%', align: 'right', value: r => r.totalQty },
    { header: 'Dibuat Oleh', width: '8%', value: r => r.createdBy || '-' },
  ];

  return (
    <div className="space-y-4">
      {result.hasAny && <PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} />}
      <DataList<Receipt>
        creds={creds} items={items} totalCount={result.hasAny ? Math.max(receipts.length, 1) : 0} getId={r => r.id} noun="dokumen"
        searchText={r => `${r.docNumber} ${r.consignorName} ${r.stallName} ${r.items.map(i => i.productName).join(' ')}`}
        searchPlaceholder="Cari no. dokumen, penitip, lapak, atau produk…" viewKey="consign-receipts"
        resetKey={`${consignorFilter}|${stallFilter}|${kindFilter}`}
        addLabel={can('create') ? 'Terima Barang' : undefined} onAdd={can('create') ? () => open('in') : undefined}
        emptyHint="Catat barang titipan yang masuk ke lapak, atau retur ke penitip."
        filters={(
          <>
            <FilterSelect value={kindFilter} onChange={setKindFilter}
              options={[{ value: '', label: 'Semua jenis' }, { value: 'in', label: 'Terima' }, { value: 'return', label: 'Retur' }]} />
            <FilterSelect value={consignorFilter} onChange={setConsignorFilter} searchPlaceholder="Cari penitip…"
              options={[{ value: '', label: 'Semua penitip' }, ...data.consignors.map(c => ({ value: c.id, label: c.name }))]} />
            <FilterSelect value={stallFilter} onChange={setStallFilter} searchPlaceholder="Cari lapak…"
              options={[{ value: '', label: 'Semua lapak' }, ...data.stalls.map(s => ({ value: s.id, label: s.name }))]} />
          </>
        )}
        headerExtra={can('create') ? (
          <button onClick={() => open('return')} className="btn-ghost text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
            <PackageMinus size={13} /> <span className="hidden sm:inline">Retur ke Penitip</span>
          </button>
        ) : undefined}
        renderBody={r => (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{r.docNumber}</p>
              <Badge tone={r.kind === 'in' ? 'ok' : 'accent'}>{r.kind === 'in' ? 'Terima' : 'Retur'}</Badge>
              <Badge>{r.stallName}</Badge>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.docDate} · {r.consignorName} · total {qtyText(r.totalQty)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{r.items.map(i => `${i.productName} ×${qtyText(i.qty)}`).join(', ')}</p>
            {r.note && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{r.note}</p>}
          </>
        )}
        renderDetail={r => (
          <DetailPanel fields={[
            { label: 'No. Dokumen', value: r.docNumber },
            { label: 'Jenis', value: r.kind === 'in' ? 'Terima barang' : 'Retur ke penitip' },
            { label: 'Tanggal', value: r.docDate },
            { label: 'Dibuat Oleh', value: r.createdBy },
            { label: 'Penitip', value: r.consignorName },
            { label: 'Lapak', value: r.stallName },
            ...(r.note ? [{ label: 'Catatan', value: r.note, wide: true }] : []),
          ]}>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Barang ({qtyText(r.totalQty)} total)</p>
              {r.items.map(i => (
                <div key={i.productId} className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{i.productName}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{qtyText(i.qty)} {i.unit}</span>
                </div>
              ))}
            </div>
          </DetailPanel>
        )}
        actions={r => can('delete') ? (
          <Tooltip label="Batalkan dokumen">
            <button onClick={() => voidDoc(r)} disabled={voidingId === r.id} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
              {voidingId === r.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
            </button>
          </Tooltip>
        ) : null}
        exportCols={cols} exportTitle="DOKUMEN TITIP JUAL (TERIMA & RETUR)" exportFile="dokumen-titip-jual"
      />

      {editing && (
        <ModalShell title={editing.kind === 'in' ? 'Terima Barang Titipan' : 'Retur ke Penitip'}
          subtitle={editing.kind === 'in' ? 'Menambah stok titipan di lapak' : 'Mengurangi stok titipan di lapak'}
          icon={editing.kind === 'in' ? <PackagePlus size={17} /> : <PackageMinus size={17} />} onClose={() => setEditing(null)} size="modal-md"
          footer={<ModalFooter onClose={() => setEditing(null)} onSave={save} saving={saving} disabled={!valid}
            label={editing.kind === 'in' ? 'Simpan Penerimaan' : 'Simpan Retur'} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Jenis dokumen: Terima (stok bertambah) atau Retur (stok berkurang) */}
            <div>
              <div className="grid grid-cols-2 gap-2">
                {([['in', 'Terima Barang', PackagePlus], ['return', 'Retur ke Penitip', PackageMinus]] as const).map(([k, label, Icon]) => (
                  <button key={k} type="button" onClick={() => setEditing({ ...editing, kind: k })}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all"
                    style={editing.kind === k
                      ? { background: k === 'in' ? 'var(--success)' : 'linear-gradient(135deg,#E8821A,#C96018)', color: '#fff' }
                      : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-2 px-3 py-2 rounded-lg" style={{ background: editing.kind === 'in' ? 'var(--success-bg)' : 'var(--accent-bg)', color: editing.kind === 'in' ? 'var(--success)' : 'var(--accent)' }}>
                {editing.kind === 'in'
                  ? 'Stok titipan di lapak BERTAMBAH. Catat saat barang diterima dari penitip.'
                  : 'Stok titipan di lapak BERKURANG — barang dikembalikan ke penitip (tidak laku/rusak). Ini bukan penjualan, jadi tidak masuk hutang.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Penitip" required>
                <SearchSelect value={editing.consignorId} onChange={v => setEditing({ ...editing, consignorId: v, lines: [{ productId: '', qty: '' }] })}
                  options={data.consignors.filter(c => c.isActive).map(c => ({ value: c.id, label: c.name, sublabel: c.code, imageUrl: c.logoUrl || undefined }))}
                  placeholder="– Pilih penitip –" searchPlaceholder="Cari penitip…" />
              </Field>
              <Field label="Lapak" required>
                <SearchSelect value={editing.stallId} onChange={v => setEditing({ ...editing, stallId: v })}
                  options={data.stalls.filter(s => s.isActive).map(s => ({ value: s.id, label: s.name, sublabel: s.code }))}
                  placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…" />
              </Field>
            </div>
            <Field label="Tanggal">
              <input className="input" type="date" value={editing.docDate} onChange={e => setEditing({ ...editing, docDate: e.target.value })} />
            </Field>

            <div>
              <label className="field-label" style={{ marginBottom: 0 }}>{editing.kind === 'in' ? 'Produk Diterima' : 'Produk Diretur'}</label>
              {!editing.consignorId ? (
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Pilih penitip dulu untuk memilih produknya.</p>
              ) : consignorProducts.length === 0 ? (
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Penitip ini belum punya produk. Tambahkan di tab Produk.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                    {editing.lines.map((l, idx) => {
                      const info = lineInfo(l);
                      const over = editing.kind === 'return' && !!info && info.qty > info.stock;
                      return (
                        <div key={idx} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center gap-2 mb-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={l.productId} onChange={v => setLine(idx, { productId: v })}
                                // Produk yang sudah dipilih di baris lain tidak ditawarkan lagi.
                                options={consignorProducts
                                  .filter(p => p.id === l.productId || !editing.lines.some((o, oi) => oi !== idx && o.productId === p.id))
                                  .map(p => ({ value: p.id, label: p.name, sublabel: editing.stallId ? `Stok di lapak: ${qtyText(stockOf(p.id, editing.stallId))} ${p.unit}` : p.code, imageUrl: p.imageUrl || undefined }))}
                                placeholder="– Produk –" searchPlaceholder="Cari produk…" />
                            </div>
                            <Tooltip label="Hapus baris">
                              <button onClick={() => setEditing({ ...editing, lines: editing.lines.filter((_, i) => i !== idx) })} disabled={editing.lines.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}><X size={14} /></button>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="field-label" style={{ fontSize: 11 }}>{editing.kind === 'in' ? 'Qty diterima' : 'Qty diretur'}{info ? ` (${info.unit})` : ''}</label>
                              <input className={`input${over ? ' input-error' : ''}`} type="number" min={0} step="any" inputMode="decimal" placeholder="0"
                                value={l.qty} onChange={e => setLine(idx, { qty: e.target.value })} />
                            </div>
                            <div>
                              <label className="field-label" style={{ fontSize: 11 }}>Stok di lapak</label>
                              <div className="input flex items-center justify-between" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                                <span className="tabular">{info && editing.stallId ? qtyText(info.stock) : '–'}</span>
                                {info && editing.stallId && info.qty > 0 && (
                                  <span className="text-[11px] tabular" style={{ color: over ? 'var(--danger)' : 'var(--text-muted)' }}>
                                    → {qtyText(editing.kind === 'in' ? info.stock + info.qty : info.stock - info.qty)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {over && <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>Qty retur melebihi stok di lapak ({qtyText(info!.stock)} {info!.unit}).</p>}
                          {info && info.qty > 0 && info.consignorShare !== null && (
                            <p className="text-xs tabular mt-2" style={{ color: 'var(--text-muted)' }}>Nilai bagian penitip: {rupiah(info.qty * info.consignorShare)}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setEditing({ ...editing, lines: [...editing.lines, { productId: '', qty: '' }] })} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Produk
                  </button>
                </>
              )}
            </div>

            <Field label="Catatan">
              <input className="input" type="text" value={editing.note} placeholder="Catatan tambahan (opsional)" onChange={e => setEditing({ ...editing, note: e.target.value })} />
            </Field>

            <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
              <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{qtyText(totalQty)} pcs</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Nilai Bagian Penitip</span>
              <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{rupiah(totalValue)}</span>
            </div>
            <ErrorBox message={error} />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
