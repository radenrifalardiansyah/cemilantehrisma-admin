'use client';

import { useState, useEffect, useCallback } from 'react';
import { PackagePlus, PackageMinus, ClipboardCheck, Undo2, Loader2, Plus, X } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import FilterSelect from '@/components/FilterSelect';
import NumberInput from '@/components/NumberInput';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import DataList, { DetailPanel, type ExportCol } from '../titip-jual/DataList';
import { API, Badge, Field, ModalShell, ModalFooter, ErrorBox, HEADER_BTN_H, rupiah, qtyText } from '../titip-jual/shared';
import { KIND_LABEL, dt, todayKey, type OwnSectionProps, type Shipment, type PriceItem } from './types';

interface Line { productId: string; qty: string; price: string }
interface Draft { kind: Shipment['kind']; stallId: string; warehouseId: string; docDate: string; note: string; lines: Line[] }

const emptyLine = (): Line => ({ productId: '', qty: '', price: '' });

async function fetchShipments(creds: string): Promise<Shipment[]> {
  const r = await fetch(`${API}/api/stall-own/shipments`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? (await r.json() as { shipments: Shipment[] }).shipments : [];
}

// Dokumen produk toko di lapak: Kirim ke Lapak (stok gudang → gudang lapak), Retur ke Gudang, dan
// Saldo Awal (mencatat stok yang sudah ada di gudang lapak supaya ikut ditagih).
export default function ShipmentsSection({ creds, stalls, warehouses, can }: OwnSectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [items, setItems] = useState<Shipment[] | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => { setItems(await fetchShipments(creds)); }, [creds]);
  useEffect(() => {
    let alive = true;
    fetchShipments(creds).then(d => { if (alive) setItems(d); });
    return () => { alive = false; };
  }, [creds]);

  const stallId = draft?.stallId ?? '';
  const warehouseId = draft?.warehouseId ?? '';
  // Daftar produk + harga + stok untuk lapak/gudang yang dipilih di dokumen.
  useEffect(() => {
    if (!stallId) return;
    let alive = true;
    fetch(`${API}/api/stall-own/prices?stallId=${stallId}&warehouseId=${warehouseId}`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<{ items: PriceItem[] }> : { items: [] })
      .then(d => { if (alive) setPriceItems(d.items); });
    return () => { alive = false; };
  }, [creds, stallId, warehouseId]);

  const stall = stalls.find(s => s.id === stallId);
  const stallWarehouse = stall ? warehouses.find(w => w.id === stall.warehouseId) : undefined;
  const byId = new Map(priceItems.map(p => [p.productId, p]));

  const open = (kind: Shipment['kind']) => { setError(''); setPriceItems([]); setDraft({ kind, stallId: '', warehouseId: '', docDate: todayKey(), note: '', lines: [emptyLine()] }); };
  const setLine = (idx: number, patch: Partial<Line>) => setDraft(d => d && ({ ...d, lines: d.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  const pickProduct = (idx: number, productId: string) => {
    const p = byId.get(productId);
    setLine(idx, { productId, price: p ? String(p.stallPrice ?? p.tokoPrice) : '' });
  };
  // Saldo Awal: isi baris otomatis dari stok yang ada di gudang lapak.
  const pickStall = async (id: string) => {
    setDraft(d => d && ({ ...d, stallId: id, lines: [emptyLine()] }));
    if (draft?.kind !== 'opening' || !id) return;
    const r = await fetch(`${API}/api/stall-own/opening-preview?stallId=${id}`, { headers: { 'x-admin-auth': creds } });
    const d = r.ok ? await r.json() as { items: { productId: string; qty: number; price: number }[] } : { items: [] };
    setDraft(cur => cur && cur.stallId === id ? ({ ...cur, lines: d.items.length > 0 ? d.items.map(i => ({ productId: i.productId, qty: String(i.qty), price: String(i.price) })) : [emptyLine()] }) : cur);
  };

  if (items === null) return <PageLoader />;

  const lineInfo = (l: Line) => {
    const p = byId.get(l.productId);
    const qty = Number(l.qty) || 0;
    if (!p || !draft) return null;
    const from = draft.kind === 'send' ? p.otherStock : p.stock;   // stok yang berkurang
    return { p, qty, from, over: draft.kind !== 'send' ? qty > p.stock : qty > p.otherStock };
  };
  const validLines = draft?.lines.filter(l => l.productId && Number(l.qty) > 0 && l.price !== '' && Number(l.price) >= 0) ?? [];
  const anyOver = !!draft && draft.lines.some(l => lineInfo(l)?.over);
  const totalQty = validLines.reduce((a, l) => a + Number(l.qty), 0);
  const totalValue = validLines.reduce((a, l) => a + Number(l.qty) * Number(l.price), 0);
  const needWarehouse = draft ? draft.kind !== 'opening' : false;
  const valid = !!draft && !!draft.stallId && (!needWarehouse || !!draft.warehouseId) && validLines.length > 0 && !anyOver;

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/stall-own/shipments`, {
      method: 'POST', headers,
      body: JSON.stringify({ kind: draft.kind, stallId: draft.stallId, warehouseId: draft.warehouseId, date: draft.docDate, note: draft.note, items: validLines.map(l => ({ productId: l.productId, qty: Number(l.qty), price: Number(l.price) })) }),
    });
    const d = await r.json().catch(() => ({})) as { shipment?: Shipment; error?: string };
    if (r.ok && d.shipment) { setDraft(null); await load(); toast.success(`${d.shipment.docNumber} disimpan.`); }
    else setError(d.error ?? 'Gagal menyimpan dokumen.');
    setSaving(false);
  };

  const voidDoc = async (s: Shipment) => {
    if (!await confirm({ message: `Batalkan ${s.docNumber}? Stok dikembalikan seperti sebelum dokumen ini.`, danger: true })) return;
    setVoidingId(s.id);
    const r = await fetch(`${API}/api/stall-own/shipments/${s.id}`, { method: 'DELETE', headers });
    if (r.ok) { await load(); toast.success(`${s.docNumber} dibatalkan.`); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membatalkan dokumen.');
    setVoidingId(null);
  };

  const shown = items.filter(s => (!kindFilter || s.kind === kindFilter) && (!stallFilter || s.stallId === stallFilter));
  const cols: ExportCol<Shipment>[] = [
    { header: 'No. Dokumen', width: '15%', bold: true, value: s => s.docNumber },
    { header: 'Jenis', width: '12%', value: s => KIND_LABEL[s.kind] },
    { header: 'Tanggal', width: '10%', value: s => s.docDate },
    { header: 'Lapak', width: '14%', value: s => s.stallName },
    { header: 'Gudang', width: '14%', value: s => s.fromWarehouseName || '-' },
    { header: 'Qty', width: '8%', align: 'right', value: s => qtyText(s.totalQty) },
    { header: 'Nilai', width: '14%', align: 'right', value: s => rupiah(s.totalValue) },
    { header: 'Status', width: '10%', value: s => s.status === 'void' ? 'Dibatalkan' : 'Aktif' },
  ];
  const meta = draft?.kind === 'send'
    ? { title: 'Kirim ke Lapak', sub: 'Memindahkan stok produk toko dari gudang ke gudang lapak', Icon: PackagePlus, save: 'Simpan Pengiriman' }
    : draft?.kind === 'return'
    ? { title: 'Retur ke Gudang', sub: 'Mengembalikan stok produk toko dari lapak ke gudang', Icon: PackageMinus, save: 'Simpan Retur' }
    : { title: 'Saldo Awal Stok Lapak', sub: 'Mencatat stok yang sudah ada di gudang lapak supaya ikut ditagih', Icon: ClipboardCheck, save: 'Simpan Saldo Awal' };

  return (
    <div className="space-y-4">
      <DataList<Shipment>
        creds={creds} items={shown} totalCount={items.length} getId={s => s.id} noun="dokumen"
        searchText={s => `${s.docNumber} ${s.stallName} ${s.fromWarehouseName} ${s.items.map(i => i.name).join(' ')}`} searchPlaceholder="Cari no. dokumen, lapak, atau produk…" viewKey="stall-own-shipments"
        resetKey={`${kindFilter}|${stallFilter}`}
        addLabel={can('create') ? 'Kirim ke Lapak' : undefined} onAdd={can('create') ? () => open('send') : undefined}
        emptyHint="Kirim produk toko ke gudang lapak. Setelah terjual, hasilnya ditagih ke lapak lewat Setoran."
        filters={(
          <>
            <FilterSelect value={kindFilter} onChange={setKindFilter}
              options={[{ value: '', label: 'Semua jenis' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))]} />
            <FilterSelect value={stallFilter} onChange={setStallFilter} searchPlaceholder="Cari lapak…"
              options={[{ value: '', label: 'Semua lapak' }, ...stalls.map(s => ({ value: s.id, label: s.name }))]} />
          </>
        )}
        headerExtra={can('create') ? (
          <>
            <button onClick={() => open('return')} className="btn-ghost text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
              <PackageMinus size={13} /> <span className="hidden sm:inline">Retur ke Gudang</span>
            </button>
            <button onClick={() => open('opening')} className="btn-ghost text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
              <ClipboardCheck size={13} /> <span className="hidden sm:inline">Saldo Awal</span>
            </button>
          </>
        ) : undefined}
        renderBody={s => (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{s.docNumber}</p>
              <Badge tone={s.status === 'void' ? 'danger' : s.kind === 'send' ? 'ok' : 'accent'}>{s.status === 'void' ? 'Dibatalkan' : KIND_LABEL[s.kind]}</Badge>
              <Badge>{s.stallName}</Badge>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.docDate}{s.fromWarehouseName ? ` · ${s.fromWarehouseName}` : ''} · {qtyText(s.totalQty)} pcs · {rupiah(s.totalValue)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{s.items.map(i => `${i.name} ×${qtyText(i.qty)}`).join(', ')}</p>
            {s.note && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.note}</p>}
          </>
        )}
        renderDetail={s => (
          <DetailPanel fields={[
            { label: 'No. Dokumen', value: s.docNumber }, { label: 'Jenis', value: KIND_LABEL[s.kind] },
            { label: 'Tanggal', value: s.docDate }, { label: 'Dibuat Oleh', value: `${s.createdBy} · ${dt(s.createdAt)}` },
            { label: 'Lapak', value: s.stallName }, { label: s.kind === 'return' ? 'Gudang Tujuan' : 'Gudang Asal', value: s.fromWarehouseName },
            ...(s.note ? [{ label: 'Catatan', value: s.note, wide: true }] : []),
          ]}>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Barang ({qtyText(s.totalQty)} total · {rupiah(s.totalValue)})</p>
              {s.items.map(i => (
                <div key={i.productId} className="flex items-center justify-between gap-2 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{i.name}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{qtyText(i.qty)} × {rupiah(i.price)}</span>
                </div>
              ))}
            </div>
          </DetailPanel>
        )}
        actions={s => can('delete') && s.status === 'active' ? (
          <Tooltip label="Batalkan dokumen">
            <button onClick={() => voidDoc(s)} disabled={voidingId === s.id} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
              {voidingId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
            </button>
          </Tooltip>
        ) : null}
        exportCols={cols} exportTitle="DOKUMEN PRODUK TOKO DI LAPAK" exportFile="dokumen-produk-toko-lapak"
      />

      {draft && (
        <ModalShell title={meta.title} subtitle={meta.sub} icon={<meta.Icon size={17} />} onClose={() => setDraft(null)} size="modal-md"
          footer={<ModalFooter onClose={() => setDraft(null)} onSave={save} saving={saving} disabled={!valid} label={meta.save} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              {draft.kind === 'send' ? 'Stok gudang asal BERKURANG, stok gudang lapak BERTAMBAH. Harga di bawah menjadi harga jual produk itu di lapak, dan itu pula yang ditagih ke lapak saat terjual.'
                : draft.kind === 'return' ? 'Stok gudang lapak BERKURANG, stok gudang tujuan BERTAMBAH. Dipakai untuk produk yang tidak laku.'
                : 'Stok TIDAK bergerak. Dokumen ini hanya memberi harga pada stok yang sudah ada di gudang lapak. Penjualannya akan ikut ditagih di Setoran.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Lapak" required>
                <SearchSelect value={draft.stallId} onChange={pickStall} placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…"
                  options={stalls.filter(s => s.isActive).map(s => ({ value: s.id, label: s.name, sublabel: s.warehouseId ? undefined : 'Belum ada gudang terkait' }))} />
              </Field>
              {needWarehouse && (
                <Field label={draft.kind === 'send' ? 'Gudang Asal' : 'Gudang Tujuan'} required>
                  <SearchSelect value={draft.warehouseId} onChange={v => setDraft({ ...draft, warehouseId: v })} placeholder="– Pilih gudang –" searchPlaceholder="Cari gudang…"
                    options={warehouses.filter(w => w.id !== stall?.warehouseId).map(w => ({ value: w.id, label: w.name }))} />
                </Field>
              )}
            </div>
            {stall && !stall.warehouseId && <ErrorBox message="Lapak ini belum punya gudang terkait. Atur dulu di menu Titip Jual → Lapak." />}
            {stall?.warehouseId && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Gudang lapak: <strong>{stallWarehouse?.name ?? '-'}</strong></p>}
            <Field label="Tanggal"><input className="input" type="date" value={draft.docDate} onChange={e => setDraft({ ...draft, docDate: e.target.value })} /></Field>

            <div>
              <label className="field-label" style={{ marginBottom: 0 }}>Produk</label>
              {!draft.stallId || (needWarehouse && !draft.warehouseId) ? (
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Pilih lapak{needWarehouse ? ' dan gudang' : ''} dulu untuk memilih produknya.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                    {draft.lines.map((l, idx) => {
                      const info = lineInfo(l);
                      return (
                        <div key={idx} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center gap-2 mb-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={l.productId} onChange={v => pickProduct(idx, v)} placeholder="– Produk –" searchPlaceholder="Cari produk…"
                                options={priceItems
                                  .filter(p => p.productId === l.productId || !draft.lines.some((o, oi) => oi !== idx && o.productId === p.productId))
                                  .map(p => ({ value: p.productId, label: p.name, sublabel: draft.kind === 'send' ? `Stok gudang: ${qtyText(p.otherStock)}` : `Stok lapak: ${qtyText(p.stock)}` }))} />
                            </div>
                            <Tooltip label="Hapus baris">
                              <button onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) })} disabled={draft.lines.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}><X size={14} /></button>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="field-label" style={{ fontSize: 11 }}>Qty</label>
                              <input className={`input${info?.over ? ' input-error' : ''}`} type="number" min={0} step="any" inputMode="decimal" placeholder="0"
                                value={l.qty} onChange={e => setLine(idx, { qty: e.target.value })} />
                            </div>
                            <div>
                              <label className="field-label" style={{ fontSize: 11 }}>Harga jual di lapak</label>
                              <NumberInput className="input" value={l.price} placeholder="Rp" onChange={raw => setLine(idx, { price: raw === '' ? '' : String(raw) })} />
                            </div>
                          </div>
                          {info && (
                            <p className="text-xs tabular mt-2" style={{ color: info.over ? 'var(--danger)' : 'var(--text-muted)' }}>
                              {info.over
                                ? `Qty melebihi stok (${qtyText(draft.kind === 'send' ? info.p.otherStock : info.p.stock)}).`
                                : draft.kind === 'send' ? `Stok gudang ${qtyText(info.p.otherStock)} → ${qtyText(info.p.otherStock - info.qty)} · stok lapak ${qtyText(info.p.stock)} → ${qtyText(info.p.stock + info.qty)}`
                                : draft.kind === 'return' ? `Stok lapak ${qtyText(info.p.stock)} → ${qtyText(info.p.stock - info.qty)}`
                                : `Stok di gudang lapak: ${qtyText(info.p.stock)}`}
                              {info.p.tokoPrice > 0 && ` · harga toko ${rupiah(info.p.tokoPrice)}`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Produk
                  </button>
                </>
              )}
            </div>
            <Field label="Catatan">
              <input className="input" type="text" value={draft.note} placeholder="Catatan tambahan (opsional)" onChange={e => setDraft({ ...draft, note: e.target.value })} />
            </Field>
            <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
              <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{qtyText(totalQty)} pcs</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Nilai (harga lapak)</span>
              <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{rupiah(totalValue)}</span>
            </div>
            <ErrorBox message={error} />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
