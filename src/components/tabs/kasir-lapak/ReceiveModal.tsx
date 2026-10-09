'use client';

import { useState, useEffect } from 'react';
import { PackagePlus, X, Plus } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';
import { ModalShell, ModalFooter, Field, ErrorBox, Badge, rupiah, qtyText } from '../titip-jual/shared';
import type { CatalogItem, PosStall } from './types';

interface Line { productId: string; qty: string }
interface ReceiptDoc { id: string; docNumber: string; consignorName: string; items: { productId: string; productName: string; unit: string; qty: number }[]; totalQty: number; note: string; createdBy: string; createdAt: { seconds: number } | null }

async function fetchReceipts(creds: string, stallId: string): Promise<ReceiptDoc[]> {
  const r = await fetch(`/api/stall-pos/receipts?stallId=${stallId}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? ((await r.json()) as { receipts: ReceiptDoc[] }).receipts : [];
}

// Terima barang titipan oleh kasir lapak (biasanya pagi hari). Lapak terkunci ke lapak yang sedang
// dibuka; hanya produk yang sudah didaftarkan admin di lapak ini yang bisa diterima; stok langsung bertambah.
export default function ReceiveModal({ creds, stall, items, onClose, onDone }: {
  creds: string; stall: PosStall; items: CatalogItem[]; onClose: () => void; onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const consignItems = items.filter(i => i.kind === 'consign' && i.consignorId);
  const consignors = [...new Map(consignItems.map(i => [i.consignorId!, i.consignorName ?? ''])).entries()].map(([id, name]) => ({ id, name }));

  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [consignorId, setConsignorId] = useState(consignors.length === 1 ? consignors[0].id : '');
  const [lines, setLines] = useState<Line[]>([{ productId: '', qty: '' }]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ReceiptDoc[] | null>(null);

  useEffect(() => {
    if (tab !== 'history') return;
    let alive = true;
    fetchReceipts(creds, stall.id).then(d => { if (alive) setHistory(d); });
    return () => { alive = false; };
  }, [creds, stall.id, tab]);

  const products = consignItems.filter(i => i.consignorId === consignorId);
  const lineInfo = (l: Line) => {
    const p = products.find(x => x.productId === l.productId);
    return p ? { p, qty: Number(l.qty) || 0 } : null;
  };
  const infos = lines.map(lineInfo);
  const totalQty = infos.reduce((a, i) => a + (i?.qty ?? 0), 0);
  const valid = !!consignorId && lines.some(l => l.productId && Number(l.qty) > 0) && lines.every(l => !l.productId || Number(l.qty) > 0);
  const setLine = (idx: number, patch: Partial<Line>) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));

  const save = async () => {
    setSaving(true); setError('');
    const r = await fetch('/api/stall-pos/receipts', {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stallId: stall.id, consignorId, note, items: lines.filter(l => l.productId).map(l => ({ productId: l.productId, qty: Number(l.qty) })) }),
    });
    const d = await r.json().catch(() => ({})) as { docNumber?: string; error?: string };
    if (r.ok && d.docNumber) {
      toast.success(`Barang diterima: ${d.docNumber}`);
      await onDone();
      setLines([{ productId: '', qty: '' }]); setNote('');
      setHistory(null); setTab('history');
    } else {
      const msg = d.error ?? 'Gagal menyimpan penerimaan.';
      setError(msg); toast.error(msg);
    }
    setSaving(false);
  };

  return (
    <ModalShell title="Terima Barang Titipan" subtitle={`${stall.name} · stok langsung bertambah`} icon={<PackagePlus size={17} />} onClose={onClose} size="modal-md"
      footer={tab === 'new'
        ? <ModalFooter onClose={onClose} onSave={save} saving={saving} disabled={!valid} label="Simpan Penerimaan" />
        : <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="inline-flex rounded-xl overflow-hidden border self-start" style={{ borderColor: 'var(--border)' }}>
          {([['new', 'Terima Baru'], ['history', 'Diterima Hari Ini']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className="px-4 py-2 text-xs font-bold"
              style={tab === id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>{label}</button>
          ))}
        </div>

        {tab === 'history' ? (
          history === null ? <PageLoader /> : history.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada barang diterima hari ini.</p>
          ) : (
            <div>
              {history.map((h, idx) => (
                <div key={h.id} className="py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{h.docNumber}</p>
                    <Badge tone="ok">Terima</Badge>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {h.consignorName} · {h.createdBy} · {h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{h.items.map(i => `${i.productName} ×${qtyText(i.qty)}`).join(', ')}</p>
                  {h.note && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{h.note}</p>}
                </div>
              ))}
            </div>
          )
        ) : consignors.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
            Belum ada produk titipan yang didaftarkan di lapak ini. Minta admin menambahkannya di Titip Jual → Produk.
          </p>
        ) : (
          <>
            <Field label="Penitip" required>
              <SearchSelect value={consignorId} onChange={v => { setConsignorId(v); setLines([{ productId: '', qty: '' }]); }}
                options={consignors.map(c => ({ value: c.id, label: c.name }))} placeholder="– Pilih penitip –" searchPlaceholder="Cari penitip…" />
            </Field>

            <div>
              <label className="field-label" style={{ marginBottom: 0 }}>Produk Diterima</label>
              {!consignorId ? (
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Pilih penitip dulu untuk memilih produknya.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                    {lines.map((l, idx) => {
                      const info = infos[idx];
                      return (
                        <div key={idx} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center gap-2 mb-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={l.productId} onChange={v => setLine(idx, { productId: v })}
                                options={products.filter(p => p.productId === l.productId || !lines.some((o, oi) => oi !== idx && o.productId === p.productId))
                                  .map(p => ({ value: p.productId, label: p.name, sublabel: `Stok di lapak: ${qtyText(p.stock)} ${p.unit}`, imageUrl: p.imageUrl || undefined }))}
                                placeholder="– Produk –" searchPlaceholder="Cari produk…" />
                            </div>
                            <Tooltip label="Hapus baris">
                              <button onClick={() => setLines(ls => ls.filter((_, i) => i !== idx))} disabled={lines.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}><X size={14} /></button>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="field-label" style={{ fontSize: 11 }}>Qty diterima{info ? ` (${info.p.unit})` : ''}</label>
                              <input className="input" type="number" min={0} step="any" inputMode="decimal" placeholder="0" value={l.qty} onChange={e => setLine(idx, { qty: e.target.value })} />
                            </div>
                            <div>
                              <label className="field-label" style={{ fontSize: 11 }}>Stok di lapak</label>
                              <div className="input flex items-center justify-between" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                                <span className="tabular">{info ? qtyText(info.p.stock) : '–'}</span>
                                {info && info.qty > 0 && <span className="text-[11px] tabular" style={{ color: 'var(--text-muted)' }}>→ {qtyText(info.p.stock + info.qty)}</span>}
                              </div>
                            </div>
                          </div>
                          {info && info.qty > 0 && <p className="text-xs tabular mt-2" style={{ color: 'var(--text-muted)' }}>Harga jual: {rupiah(info.p.price)} / {info.p.unit}</p>}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setLines(ls => [...ls, { productId: '', qty: '' }])} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Produk
                  </button>
                </>
              )}
            </div>

            <Field label="Catatan">
              <input className="input" type="text" value={note} maxLength={200} placeholder="Catatan tambahan (opsional)" onChange={e => setNote(e.target.value)} />
            </Field>
            <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
              <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{qtyText(totalQty)} pcs</span>
            </div>
            <ErrorBox message={error} />
          </>
        )}
      </div>
    </ModalShell>
  );
}
