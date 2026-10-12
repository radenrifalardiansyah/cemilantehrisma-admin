'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, RotateCcw, Check, Loader2 } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { API, Badge, HEADER_BTN_H, rupiah, qtyText } from '../titip-jual/shared';
import type { OwnSectionProps, PriceItem } from './types';

// Harga jual produk toko per lapak. Kosong = ikut harga toko. Perubahan berlaku untuk penjualan berikutnya.
export default function PricesSection({ creds, stalls, can }: OwnSectionProps) {
  const toast = useToast();
  const [stallId, setStallId] = useState('');
  const [items, setItems] = useState<PriceItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const r = await fetch(`${API}/api/stall-own/prices?stallId=${id}`, { headers: { 'x-admin-auth': creds } });
    setItems(r.ok ? (await r.json() as { items: PriceItem[] }).items : []);
  }, [creds]);

  useEffect(() => {
    if (!stallId) return;
    let alive = true;
    fetch(`${API}/api/stall-own/prices?stallId=${stallId}`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<{ items: PriceItem[] }> : { items: [] })
      .then(d => { if (alive) { setItems(d.items); setEdits({}); } });
    return () => { alive = false; };
  }, [creds, stallId]);

  const put = async (productId: string, price: number | null) => {
    setBusyId(productId);
    const r = await fetch(`${API}/api/stall-own/prices`, {
      method: 'PUT', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ stallId, productId, price }),
    });
    if (r.ok) {
      await load(stallId);
      setEdits(e => { const n = { ...e }; delete n[productId]; return n; });
      toast.success(price === null ? 'Harga kembali mengikuti harga toko.' : 'Harga lapak disimpan.');
    } else toast.error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal menyimpan harga.');
    setBusyId(null);
  };

  const q = search.trim().toLowerCase();
  const shown = (items ?? []).filter(p => (showAll || p.stock > 0 || p.stallPrice !== null) && (!q || `${p.name} ${p.code}`.toLowerCase().includes(q)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="sm:w-64 min-w-0">
          <SearchSelect value={stallId} onChange={v => { setStallId(v); setItems(null); setSearch(''); }} placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…"
            options={stalls.filter(s => s.isActive).map(s => ({ value: s.id, label: s.name, sublabel: s.code }))} />
        </div>
        <div className="relative flex-1 min-w-0">
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder="Cari produk…" />
        </div>
        <label className="flex items-center gap-2 text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Tampilkan semua produk
        </label>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Harga di sini adalah harga jual di Kasir Lapak sekaligus harga yang ditagih ke lapak. Kosongkan untuk mengikuti harga toko.</p>

      {!stallId ? (
        <div className="card p-8 text-center text-sm" style={{ borderStyle: 'dashed', color: 'var(--text-muted)' }}>Pilih lapak untuk mengatur harga produk tokonya.</div>
      ) : items === null ? <PageLoader /> : shown.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ borderStyle: 'dashed', color: 'var(--text-muted)' }}>
          {showAll ? 'Produk tidak ditemukan.' : 'Belum ada produk toko di gudang lapak ini. Kirim barang lewat tab Kirim & Retur, atau centang "Tampilkan semua produk".'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {shown.map((p, idx) => {
            const edit = edits[p.productId];
            const current = edit ?? (p.stallPrice === null ? '' : String(p.stallPrice));
            const dirty = edit !== undefined && edit !== (p.stallPrice === null ? '' : String(p.stallPrice));
            return (
              <div key={p.productId} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                    {p.stallPrice !== null && <Badge tone="accent">Harga khusus</Badge>}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Harga toko {rupiah(p.tokoPrice)} · stok di lapak {qtyText(p.stock)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <NumberInput className="input" style={{ width: 150, height: HEADER_BTN_H }} value={current} placeholder={rupiah(p.tokoPrice)} disabled={!can('edit')}
                    onChange={raw => setEdits(e => ({ ...e, [p.productId]: raw === '' ? '' : String(raw) }))} />
                  {can('edit') && (
                    <>
                      <Tooltip label="Simpan harga">
                        <button onClick={() => put(p.productId, current === '' ? null : Number(current))} disabled={!dirty || busyId === p.productId} className="btn-primary p-0 flex items-center justify-center disabled:opacity-30" style={{ width: HEADER_BTN_H, height: HEADER_BTN_H }}>
                          {busyId === p.productId ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        </button>
                      </Tooltip>
                      <Tooltip label="Kembali ke harga toko">
                        <button onClick={() => put(p.productId, null)} disabled={p.stallPrice === null || busyId === p.productId} className="btn-ghost p-0 flex items-center justify-center disabled:opacity-30" style={{ width: HEADER_BTN_H, height: HEADER_BTN_H }}>
                          <RotateCcw size={13} />
                        </button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
