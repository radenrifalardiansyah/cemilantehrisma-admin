'use client';

import { useState, useEffect, useCallback } from 'react';
import { PackagePlus, PackageMinus, Trash2, Loader2, Undo2, Plus } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import FilterSelect from '@/components/FilterSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import DataList, { type ExportCol } from './DataList';
import {
  API, HEADER_BTN_H, Badge, Field, ModalShell, ModalFooter, ErrorBox, qtyText,
  type SectionProps, type Receipt,
} from './shared';

interface Line { productId: string; qty: string }
interface Form { kind: 'in' | 'return'; consignorId: string; stallId: string; docDate: string; note: string; lines: Line[] }

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function fetchReceipts(creds: string): Promise<Receipt[]> {
  const r = await fetch(`${API}/api/consign/receipts`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? ((await r.json()) as { receipts: Receipt[] }).receipts : [];
}

export default function ReceiptsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [consignorFilter, setConsignorFilter] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [editing, setEditing] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadReceipts = useCallback(async () => { setReceipts(await fetchReceipts(creds)); }, [creds]);
  useEffect(() => {
    let alive = true;
    fetchReceipts(creds).then(d => { if (alive) setReceipts(d); });
    return () => { alive = false; };
  }, [creds]);

  const open = (kind: 'in' | 'return') => {
    setError('');
    setEditing({ kind, consignorId: consignorFilter, stallId: stallFilter, docDate: todayKey(), note: '', lines: [{ productId: '', qty: '' }] });
  };

  const consignorProducts = editing ? data.products.filter(p => p.consignorId === editing.consignorId && (p.isActive || editing.kind === 'return')) : [];
  const stockOf = (productId: string, stallId: string) =>
    data.stallItems.find(i => i.productId === productId && i.stallId === stallId)?.stockQty ?? 0;

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
    && editing.lines.every(l => !l.productId || Number(l.qty) > 0);

  if (receipts === null) return <PageLoader />;

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
      <DataList<Receipt>
        creds={creds} items={items} totalCount={receipts.length} getId={r => r.id} noun="dokumen"
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Penitip" required>
                <select className="input" value={editing.consignorId}
                  onChange={e => setEditing({ ...editing, consignorId: e.target.value, lines: [{ productId: '', qty: '' }] })}>
                  <option value="">— Pilih penitip —</option>
                  {data.consignors.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Lapak" required>
                <select className="input" value={editing.stallId} onChange={e => setEditing({ ...editing, stallId: e.target.value })}>
                  <option value="">— Pilih lapak —</option>
                  {data.stalls.filter(s => s.isActive).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Tanggal">
              <input className="input" type="date" value={editing.docDate} onChange={e => setEditing({ ...editing, docDate: e.target.value })} />
            </Field>

            <div>
              <p className="field-label">Barang</p>
              {!editing.consignorId ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pilih penitip dulu untuk memilih produknya.</p>
              ) : consignorProducts.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Penitip ini belum punya produk. Tambahkan di tab Produk.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {editing.lines.map((l, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select className="input" style={{ flex: 3 }} value={l.productId} onChange={e => setLine(idx, { productId: e.target.value })}>
                        <option value="">— Pilih produk —</option>
                        {consignorProducts.map(p => (
                          <option key={p.id} value={p.id} disabled={editing.lines.some((o, oi) => oi !== idx && o.productId === p.id)}>
                            {p.name}{editing.stallId ? ` (stok ${qtyText(stockOf(p.id, editing.stallId))})` : ''}
                          </option>
                        ))}
                      </select>
                      <input className="input" style={{ flex: 1, minWidth: 70 }} type="number" min={0} step="any" inputMode="decimal" placeholder="Qty"
                        value={l.qty} onChange={e => setLine(idx, { qty: e.target.value })} />
                      {editing.lines.length > 1 && (
                        <button className="btn-ghost p-2" style={{ color: 'var(--danger)' }}
                          onClick={() => setEditing({ ...editing, lines: editing.lines.filter((_, i) => i !== idx) })}><Trash2 size={13} /></button>
                      )}
                    </div>
                  ))}
                  <button className="btn-ghost text-xs self-start" onClick={() => setEditing({ ...editing, lines: [...editing.lines, { productId: '', qty: '' }] })}>
                    <Plus size={12} /> Tambah baris
                  </button>
                </div>
              )}
            </div>

            <Field label="Catatan (opsional)">
              <textarea className="input" style={{ resize: 'vertical', minHeight: 56 }} value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} />
            </Field>
            <ErrorBox message={error} />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
