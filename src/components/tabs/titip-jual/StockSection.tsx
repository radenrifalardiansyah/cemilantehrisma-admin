'use client';

import { useState, useEffect } from 'react';
import { Search, History } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import Pager from './Pager';
import { API, HEADER_BTN_H, Badge, ModalShell, usePaged, rupiah, qtyText, effectiveFor, type SectionProps } from './shared';

interface LedgerEntry {
  id: string; type: string; qty: number; balanceAfter: number; note: string; createdAt: { seconds: number } | null;
}

const TYPE_LABEL: Record<string, string> = { in: 'Terima barang', return: 'Retur ke penitip', void: 'Pembatalan', sale: 'Terjual' };

export default function StockSection({ creds, data }: SectionProps) {
  const [search, setSearch] = useState('');
  const [stallFilter, setStallFilter] = useState('');
  const [consignorFilter, setConsignorFilter] = useState('');
  const [onlyStock, setOnlyStock] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [history, setHistory] = useState<{ title: string; productId: string; stallId: string } | null>(null);

  const productById = new Map(data.products.map(p => [p.id, p]));
  const consignorById = new Map(data.consignors.map(c => [c.id, c]));
  const stallById = new Map(data.stalls.map(s => [s.id, s]));

  const q = search.trim().toLowerCase();
  const lines = data.stallItems
    .map(i => {
      const p = productById.get(i.productId);
      if (!p) return null;
      const c = consignorById.get(p.consignorId);
      return { item: i, p, c, stall: stallById.get(i.stallId), eff: effectiveFor(p, c, i) };
    })
    .filter((l): l is NonNullable<typeof l> => !!l)
    .filter(l => !stallFilter || l.item.stallId === stallFilter)
    .filter(l => !consignorFilter || l.p.consignorId === consignorFilter)
    .filter(l => !onlyStock || l.item.stockQty > 0)
    .filter(l => !q || l.p.name.toLowerCase().includes(q) || (l.c?.name ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.p.name.localeCompare(b.p.name, 'id', { sensitivity: 'base' }));
  const { rows, safePage, totalPages } = usePaged(lines, page, pageSize);

  const totalQty = lines.reduce((a, l) => a + l.item.stockQty, 0);
  const totalOwed = lines.reduce((a, l) => a + l.item.stockQty * l.eff.share.consignor, 0);
  const totalOurs = lines.reduce((a, l) => a + l.item.stockQty * l.eff.share.ours, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder="Cari produk atau penitip…"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input text-sm" style={{ height: HEADER_BTN_H, padding: '0 10px', width: 'auto' }} value={stallFilter} onChange={e => { setStallFilter(e.target.value); setPage(1); }}>
            <option value="">Semua lapak</option>
            {data.stalls.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input text-sm" style={{ height: HEADER_BTN_H, padding: '0 10px', width: 'auto' }} value={consignorFilter} onChange={e => { setConsignorFilter(e.target.value); setPage(1); }}>
            <option value="">Semua penitip</option>
            {data.consignors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={onlyStock} onChange={e => { setOnlyStock(e.target.checked); setPage(1); }} /> Hanya yang ada stok
          </label>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total stok', val: qtyText(totalQty) },
          { label: 'Nilai untuk penitip', val: rupiah(totalOwed) },
          { label: 'Potensi bagian kita', val: rupiah(totalOurs) },
        ].map(s => (
          <div key={s.label} className="card p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{s.val}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada stok titipan{onlyStock ? ' — coba matikan filter "Hanya yang ada stok"' : ''}.</p></div>
      ) : (
        <div className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
          {rows.map((l, idx) => (
            <div key={l.item.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{l.p.name}</p>
                  <Badge tone="accent">{l.stall?.name ?? '?'}</Badge>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {l.c?.name ?? '—'} · jual {rupiah(l.eff.price)} · penitip {rupiah(l.eff.share.consignor)} · kita {rupiah(l.eff.share.ours)}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold" style={{ color: l.item.stockQty > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{qtyText(l.item.stockQty)}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l.p.unit}</p>
              </div>
              <Tooltip label="Riwayat stok">
                <button className="btn-ghost p-2" onClick={() => setHistory({ title: `${l.p.name} — ${l.stall?.name ?? ''}`, productId: l.item.productId, stallId: l.item.stallId })}>
                  <History size={13} />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      <Pager total={lines.length} noun="baris" page={safePage} totalPages={totalPages} pageSize={pageSize}
        onPage={p => setPage(Math.max(1, Math.min(p, totalPages)))} onPageSize={n => { setPageSize(n); setPage(1); }} />

      {history && <LedgerModal creds={creds} {...history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function LedgerModal({ creds, title, productId, stallId, onClose }: { creds: string; title: string; productId: string; stallId: string; onClose: () => void }) {
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/consign/stock?productId=${productId}&stallId=${stallId}`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() : { ledger: [] })
      .then((d: { ledger: LedgerEntry[] }) => { if (alive) setLedger(d.ledger); });
    return () => { alive = false; };
  }, [creds, productId, stallId]);

  return (
    <ModalShell title="Riwayat Stok" subtitle={title} icon={<History size={17} />} onClose={onClose}
      footer={<button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>}>
      {ledger === null ? <PageLoader /> : ledger.length === 0 ? (
        <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>Belum ada pergerakan stok.</p>
      ) : (
        <div>
          {ledger.map((e, idx) => (
            <div key={e.id} className="flex items-center justify-between gap-3 py-2.5" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{TYPE_LABEL[e.type] ?? e.type}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {e.createdAt ? new Date(e.createdAt.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold" style={{ color: e.qty >= 0 ? '#059669' : 'var(--danger)' }}>{e.qty >= 0 ? '+' : ''}{qtyText(e.qty)}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>saldo {qtyText(e.balanceAfter)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
