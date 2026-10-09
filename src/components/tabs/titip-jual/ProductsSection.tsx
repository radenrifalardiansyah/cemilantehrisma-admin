'use client';

import { useState } from 'react';
import { Package, Plus, Pencil, Trash2, Loader2, Search } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { schemeText, type ShareScheme } from '@/lib/consign';
import Pager from './Pager';
import {
  API, HEADER_BTN_H, Badge, Field, ModalShell, ModalFooter, ErrorBox, SchemeFields, usePaged, rupiah, qtyText, effectiveFor,
  type SectionProps, type CProduct,
} from './shared';

interface StallCfg { enabled: boolean; price: string; scheme: ShareScheme | null; schemeValue: number | null }
interface Form {
  id?: string; consignorId: string; name: string; unit: string; defaultPrice: string;
  scheme: ShareScheme | null; schemeValue: number | null; note: string; isActive: boolean;
  stalls: Record<string, StallCfg>;
}

export default function ProductsSection({ creds, data, reload, can }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [search, setSearch] = useState('');
  const [consignorFilter, setConsignorFilter] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const consignorById = new Map(data.consignors.map(c => [c.id, c]));
  const itemsByProduct = new Map<string, typeof data.stallItems>();
  for (const i of data.stallItems) {
    const arr = itemsByProduct.get(i.productId) ?? [];
    arr.push(i); itemsByProduct.set(i.productId, arr);
  }
  const stallById = new Map(data.stalls.map(s => [s.id, s]));

  const q = search.trim().toLowerCase();
  const filtered = data.products
    .filter(p => !consignorFilter || p.consignorId === consignorFilter)
    .filter(p => !stallFilter || (itemsByProduct.get(p.id) ?? []).some(i => i.stallId === stallFilter))
    .filter(p => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
      || (consignorById.get(p.consignorId)?.name ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  const { rows, safePage, totalPages } = usePaged(filtered, page, pageSize);

  const blankStalls = (): Record<string, StallCfg> =>
    Object.fromEntries(data.stalls.map(s => [s.id, { enabled: false, price: '', scheme: null, schemeValue: null }]));

  const openNew = () => {
    setError('');
    setEditing({
      consignorId: consignorFilter || '', name: '', unit: 'pcs', defaultPrice: '', scheme: null, schemeValue: null,
      note: '', isActive: true, stalls: blankStalls(),
    });
  };
  const openEdit = (p: CProduct) => {
    setError('');
    const stalls = blankStalls();
    for (const i of itemsByProduct.get(p.id) ?? []) {
      stalls[i.stallId] = { enabled: true, price: i.price === null ? '' : String(i.price), scheme: i.scheme, schemeValue: i.schemeValue };
    }
    setEditing({
      id: p.id, consignorId: p.consignorId, name: p.name, unit: p.unit, defaultPrice: String(p.defaultPrice),
      scheme: p.scheme, schemeValue: p.schemeValue, note: p.note, isActive: p.isActive, stalls,
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    const body = {
      consignorId: editing.consignorId, name: editing.name, unit: editing.unit, defaultPrice: Number(editing.defaultPrice || 0),
      scheme: editing.scheme, schemeValue: editing.schemeValue, note: editing.note, isActive: editing.isActive,
      stallItems: Object.entries(editing.stalls).filter(([, c]) => c.enabled).map(([stallId, c]) => ({
        stallId, price: c.price === '' ? null : Number(c.price), scheme: c.scheme, schemeValue: c.schemeValue,
      })),
    };
    const r = await fetch(`${API}/api/consign/products${editing.id ? `/${editing.id}` : ''}`, {
      method: editing.id ? 'PUT' : 'POST', headers, body: JSON.stringify(body),
    });
    if (r.ok) {
      await reload(); setEditing(null);
      toast.success(editing.id ? 'Produk diperbarui.' : 'Produk titipan ditambahkan.');
    } else {
      setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menyimpan produk.');
    }
    setSaving(false);
  };

  const del = async (p: CProduct) => {
    if (!await confirm({ message: `Hapus produk titipan "${p.name}"?`, danger: true })) return;
    setDeletingId(p.id);
    const r = await fetch(`${API}/api/consign/products/${p.id}`, { method: 'DELETE', headers });
    if (r.ok) { await reload(); toast.success('Produk dihapus.'); }
    else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menghapus produk.');
    setDeletingId(null);
  };

  const setStall = (stallId: string, patch: Partial<StallCfg>) =>
    setEditing(e => e && ({ ...e, stalls: { ...e.stalls, [stallId]: { ...e.stalls[stallId], ...patch } } }));

  const editConsignor = editing ? consignorById.get(editing.consignorId) : undefined;
  const editPrice = Number(editing?.defaultPrice) || 0;
  const needSetup = data.consignors.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        {data.products.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder="Cari produk, kode, atau penitip…"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        )}
        <div className="flex items-center gap-2">
          {data.products.length > 0 && (
            <>
              <select className="input text-sm" style={{ height: HEADER_BTN_H, padding: '0 10px', width: 'auto' }} value={consignorFilter}
                onChange={e => { setConsignorFilter(e.target.value); setPage(1); }}>
                <option value="">Semua penitip</option>
                {data.consignors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="input text-sm" style={{ height: HEADER_BTN_H, padding: '0 10px', width: 'auto' }} value={stallFilter}
                onChange={e => { setStallFilter(e.target.value); setPage(1); }}>
                <option value="">Semua lapak</option>
                {data.stalls.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          )}
          {can('create') && data.products.length > 0 && (
            <button onClick={openNew} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}>
              <Plus size={13} /> <span className="hidden sm:inline">Tambah Produk</span>
            </button>
          )}
        </div>
      </div>

      {data.products.length === 0 ? (
        needSetup
          ? <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tambahkan Penitip terlebih dahulu di tab Penitip, lalu kembali ke sini.</p></div>
          : <EmptyAddCard label="Tambah Produk Titipan" onClick={openNew} />
      ) : rows.length === 0 ? (
        <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p></div>
      ) : (
        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
          {rows.map((p, idx) => {
            const c = consignorById.get(p.consignorId);
            const items = itemsByProduct.get(p.id) ?? [];
            const base = effectiveFor(p, c, undefined);
            return (
              <div key={p.id} className="px-4 py-3.5" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                      <Badge>{p.code}</Badge>
                      {!p.isActive && <Badge tone="danger">Nonaktif</Badge>}
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {c?.name ?? '—'} · {rupiah(base.price)}/{p.unit} · {schemeText(base.spec)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {items.length === 0 && <Badge>Belum ada lapak</Badge>}
                      {items.map(i => {
                        const e = effectiveFor(p, c, i);
                        return (
                          <Badge key={i.id} tone={i.stockQty > 0 ? 'ok' : 'muted'}>
                            {stallById.get(i.stallId)?.name ?? '?'}: {qtyText(i.stockQty)} · {rupiah(e.price)}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {can('edit') && (
                      <Tooltip label="Edit"><button onClick={() => openEdit(p)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}><Pencil size={13} /></button></Tooltip>
                    )}
                    {can('delete') && (
                      <Tooltip label="Hapus">
                        <button onClick={() => del(p)} disabled={deletingId === p.id} className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                          {deletingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Pager total={filtered.length} noun="produk" page={safePage} totalPages={totalPages} pageSize={pageSize}
        onPage={p => setPage(Math.max(1, Math.min(p, totalPages)))} onPageSize={n => { setPageSize(n); setPage(1); }} />

      {editing && (
        <ModalShell title={editing.id ? 'Edit Produk Titipan' : 'Tambah Produk Titipan'} subtitle="Harga & bagi hasil per lapak"
          icon={<Package size={17} />} onClose={() => setEditing(null)} size="modal-md"
          footer={<ModalFooter onClose={() => setEditing(null)} onSave={save} saving={saving}
            disabled={!editing.name.trim() || !editing.consignorId} label="Simpan Produk" />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Penitip" required>
              <select className="input" value={editing.consignorId} onChange={e => setEditing({ ...editing, consignorId: e.target.value })}>
                <option value="">— Pilih penitip —</option>
                {data.consignors.filter(c => c.isActive || c.id === editing.consignorId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Nama Produk" required>
              <input className="input" value={editing.name} autoFocus={!editing.id} onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Harga jual default (Rp)" required>
                <input className="input" type="number" min={0} inputMode="numeric" value={editing.defaultPrice} onChange={e => setEditing({ ...editing, defaultPrice: e.target.value })} />
              </Field>
              <Field label="Satuan">
                <input className="input" value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value })} />
              </Field>
            </div>
            <Field label="Skema bagi hasil produk">
              <SchemeFields scheme={editing.scheme} value={editing.schemeValue} allowInherit price={editPrice}
                inheritLabel={editConsignor ? `Ikut penitip (${schemeText({ scheme: editConsignor.scheme, value: editConsignor.schemeValue })})` : 'Ikut default penitip'}
                onChange={(s, v) => setEditing({ ...editing, scheme: s, schemeValue: v })} />
            </Field>

            <div>
              <p className="field-label">Dijual di lapak</p>
              {data.stalls.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada lapak. Tambahkan di tab Lapak.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.stalls.map(s => {
                    const cfg = editing.stalls[s.id];
                    if (!cfg) return null;
                    const stallPrice = cfg.price === '' ? editPrice : Number(cfg.price) || 0;
                    return (
                      <div key={s.id} className="card p-3" style={{ borderColor: cfg.enabled ? 'var(--accent)' : undefined }}>
                        <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          <input type="checkbox" checked={cfg.enabled} onChange={e => setStall(s.id, { enabled: e.target.checked })} />
                          {s.name} {!s.isActive && <Badge tone="danger">Nonaktif</Badge>}
                        </label>
                        {cfg.enabled && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                            <Field label="Harga jual di lapak ini (kosong = default)">
                              <input className="input" type="number" min={0} inputMode="numeric" value={cfg.price} placeholder={String(editPrice)}
                                onChange={e => setStall(s.id, { price: e.target.value })} />
                            </Field>
                            <Field label="Skema bagi hasil di lapak ini">
                              <SchemeFields scheme={cfg.scheme} value={cfg.schemeValue} allowInherit price={stallPrice}
                                inheritLabel="Ikut produk / penitip"
                                onChange={(sc, v) => setStall(s.id, { scheme: sc, schemeValue: v })} />
                            </Field>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Lapak yang sudah punya stok tidak bisa dilepas — kembalikan stoknya lebih dulu lewat tab Dokumen.
              </p>
            </div>

            <Field label="Catatan (opsional)">
              <textarea className="input" style={{ resize: 'vertical', minHeight: 56 }} value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} />
              Produk aktif
            </label>
            <ErrorBox message={error} />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
