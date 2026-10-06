'use client';

import { useMemo, useState } from 'react';
import { Loader2, Search, ClipboardCheck, RefreshCw } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

interface Wh { id: string; name: string }
interface Prod { id: string; name: string; category?: string }

// Stok opname per gudang: isi hitung fisik hanya untuk produk yang dicek (kosong = tidak
// dihitung, tidak diubah). Yang berselisih dikoreksi sekaligus lewat POST /api/stock/opname.
export default function StockOpnamePanel({ creds, warehouses, products, onDone }: {
  creds: string; warehouses: Wh[]; products: Prod[]; onDone?: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [warehouseId, setWarehouseId] = useState('');
  const [system, setSystem] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    const r = await fetch(`/api/warehouses/${id}/stock`, { headers });
    if (r.ok) {
      const { stocks } = await r.json() as { stocks: { productId: string; stockQty: number }[] };
      setSystem(Object.fromEntries(stocks.map(s => [s.productId, s.stockQty])));
    } else {
      toast.error('Gagal memuat stok gudang.');
    }
    setLoading(false);
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .map(p => {
        const sys = system[p.id] ?? 0;
        const raw = counted[p.id];
        const has = raw !== undefined && raw !== '';
        return { ...p, sys, has, countedQty: has ? Number(raw) : 0, diff: has ? Number(raw) - sys : 0 };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, system, counted, search]);

  const changed = products
    .map(p => ({ id: p.id, name: p.name, sys: system[p.id] ?? 0, raw: counted[p.id] }))
    .filter(p => p.raw !== undefined && p.raw !== '' && Number(p.raw) !== p.sys);

  const wh = warehouses.find(w => w.id === warehouseId);
  const save = async () => {
    if (changed.length === 0) return;
    const surplus = changed.filter(c => Number(c.raw) > c.sys).length;
    if (!await confirm({
      message: `Simpan stok opname gudang "${wh?.name}"? ${changed.length} produk akan dikoreksi (${surplus} lebih, ${changed.length - surplus} kurang). Stok sistem langsung diganti dengan hasil hitung fisik.`,
    })) return;
    setSaving(true);
    const r = await fetch('/api/stock/opname', {
      method: 'POST', headers,
      body: JSON.stringify({
        warehouseId, warehouseName: wh?.name, note,
        items: products.filter(p => counted[p.id] !== undefined && counted[p.id] !== '').map(p => ({ productId: p.id, countedQty: Number(counted[p.id]) })),
      }),
    });
    const d = await r.json().catch(() => ({})) as { error?: string; adjusted?: number };
    if (r.ok) {
      toast.success(`Stok opname tersimpan — ${d.adjusted ?? 0} produk dikoreksi.`);
      setCounted({}); setNote('');
      await load(warehouseId);
      onDone?.();
    } else {
      toast.error(d.error ?? 'Gagal menyimpan stok opname.');
    }
    setSaving(false);
  };

  return (
    <div className="p-4 lg:p-6 animate-fade-up space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="sm:w-72">
          <SearchSelect value={warehouseId} onChange={v => { setWarehouseId(v); setCounted({}); if (v) load(v); }}
            options={warehouses.map(w => ({ value: w.id, label: w.name }))}
            placeholder="– Pilih Gudang –" searchPlaceholder="Cari gudang…" />
        </div>
        {warehouseId && (
          <>
            <div className="relative flex-1 min-w-0">
              <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} className="input text-sm w-full" style={{ paddingLeft: 38, height: 34 }} placeholder="Cari produk…" />
            </div>
            <button onClick={() => load(warehouseId)} className="btn-ghost p-0 flex items-center justify-center" style={{ height: 34, width: 34 }} title="Muat ulang stok sistem">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </>
        )}
      </div>

      {!warehouseId ? (
        <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
          <ClipboardCheck size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Stok Opname</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Pilih gudang, lalu isi jumlah hitung fisik untuk produk yang dicek.</p>
        </div>
      ) : loading ? (
        <PageLoader compact />
      ) : (
        <>
          <div className="card overflow-hidden divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
            {rows.length === 0 && <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p>}
            {rows.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                  <p className="text-[11px] tabular" style={{ color: 'var(--text-muted)' }}>Sistem: {p.sys}</p>
                </div>
                <input
                  type="number" inputMode="numeric" min={0} step={1}
                  value={counted[p.id] ?? ''} placeholder="Fisik"
                  onChange={e => setCounted(c => ({ ...c, [p.id]: e.target.value }))}
                  className="input text-sm text-right tabular" style={{ width: 90, height: 34 }} />
                <span className="w-14 text-right text-xs font-extrabold tabular"
                  style={{ color: !p.has || p.diff === 0 ? 'var(--text-muted)' : p.diff > 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {!p.has ? '–' : p.diff === 0 ? 'Sesuai' : p.diff > 0 ? `+${p.diff}` : p.diff}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input type="text" value={note} onChange={e => setNote(e.target.value)} className="input flex-1" placeholder="Catatan opname (opsional), mis. opname akhir bulan" />
            <button onClick={save} disabled={saving || changed.length === 0} className="btn-primary text-xs" style={{ height: 38 }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
              Simpan Opname{changed.length > 0 ? ` (${changed.length} selisih)` : ''}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
