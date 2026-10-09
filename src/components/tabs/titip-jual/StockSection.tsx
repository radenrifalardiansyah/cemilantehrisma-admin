'use client';

import { useState, useEffect } from 'react';
import { History, PackageCheck } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import { schemeText } from '@/lib/consign';
import FilterSelect from '@/components/FilterSelect';
import DataList, { DetailPanel, type ExportCol } from './DataList';
import {
  API, HEADER_BTN_H, Badge, ModalShell, rupiah, qtyText, effectiveFor,
  type SectionProps, type CProduct, type Consignor, type Stall, type StallItem,
} from './shared';

interface LedgerEntry {
  id: string; type: string; qty: number; balanceAfter: number; note: string; createdAt: { seconds: number } | null;
}

const TYPE_LABEL: Record<string, string> = { in: 'Terima barang', return: 'Retur ke penitip', void: 'Pembatalan', sale: 'Terjual' };

interface Line { item: StallItem; p: CProduct; c: Consignor | undefined; stall: Stall | undefined; eff: ReturnType<typeof effectiveFor> }

export default function StockSection({ creds, data, can, goTo }: SectionProps) {
  const [stallFilter, setStallFilter] = useState('');
  const [consignorFilter, setConsignorFilter] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [history, setHistory] = useState<{ title: string; productId: string; stallId: string } | null>(null);

  const productById = new Map(data.products.map(p => [p.id, p]));
  const consignorById = new Map(data.consignors.map(c => [c.id, c]));
  const stallById = new Map(data.stalls.map(s => [s.id, s]));

  const all: Line[] = data.stallItems.flatMap(i => {
    const p = productById.get(i.productId);
    if (!p) return [];
    const c = consignorById.get(p.consignorId);
    return [{ item: i, p, c, stall: stallById.get(i.stallId), eff: effectiveFor(p, c, i) }];
  });
  const lines = all
    .filter(l => !stallFilter || l.item.stallId === stallFilter)
    .filter(l => !consignorFilter || l.p.consignorId === consignorFilter)
    .filter(l => !onlyInStock || l.item.stockQty > 0)
    .sort((a, b) => a.p.name.localeCompare(b.p.name, 'id', { sensitivity: 'base' }));

  // Kosong = belum ada produk yang dijual di lapak mana pun — tampilkan kartu "Terima Barang"
  // seperti tab lain.
  const empty = all.length === 0;
  const canReceive = can('create') && !!goTo;

  const totalQty = lines.reduce((a, l) => a + l.item.stockQty, 0);
  const totalOwed = lines.reduce((a, l) => a + l.item.stockQty * (l.eff.share?.consignor ?? 0), 0);
  const totalOurs = lines.reduce((a, l) => a + l.item.stockQty * (l.eff.share?.ours ?? 0), 0);

  const cols: ExportCol<Line>[] = [
    { header: 'Produk', width: '18%', bold: true, value: l => l.p.name },
    { header: 'Penitip', width: '14%', value: l => l.c?.name ?? '-' },
    { header: 'Lapak', width: '11%', value: l => l.stall?.name ?? '-' },
    { header: 'Stok', width: '7%', align: 'right', value: l => l.item.stockQty },
    { header: 'Satuan', width: '7%', value: l => l.p.unit },
    { header: 'Harga Jual', width: '10%', align: 'right', value: l => rupiah(l.eff.price) },
    { header: 'Bagian Penitip', width: '11%', align: 'right', value: l => l.eff.share ? rupiah(l.eff.share.consignor) : '-' },
    { header: 'Bagian Kita', width: '10%', align: 'right', value: l => l.eff.share ? rupiah(l.eff.share.ours) : '-' },
  ];

  return (
    <div className="space-y-4">
      {!empty && <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: 'Total stok', val: qtyText(totalQty) },
          { label: 'Nilai untuk penitip', val: rupiah(totalOwed) },
          { label: 'Potensi bagian kita', val: rupiah(totalOurs) },
        ].map(s => (
          <div key={s.label} className="card p-2.5 sm:p-3 min-w-0">
            <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            <p className="text-xs sm:text-sm font-bold mt-0.5 break-words" style={{ color: 'var(--text-primary)' }}>{s.val}</p>
          </div>
        ))}
      </div>}

      <DataList<Line>
        creds={creds} items={lines} totalCount={empty ? 0 : all.length} getId={l => l.item.id} noun="baris stok"
        searchText={l => `${l.p.name} ${l.c?.name ?? ''} ${l.stall?.name ?? ''}`} searchPlaceholder="Cari produk, penitip, atau lapak…"
        viewKey="consign-stock" resetKey={`${stallFilter}|${consignorFilter}|${onlyInStock}`}
        addLabel={canReceive ? 'Terima Barang' : undefined} onAdd={canReceive ? () => goTo!('receipts') : undefined}
        emptyHint="Belum ada stok titipan. Catat barang yang diterima dari penitip di tab Terima & Retur."
        filters={(
          <>
            <FilterSelect value={stallFilter} onChange={setStallFilter} searchPlaceholder="Cari lapak…"
              options={[{ value: '', label: 'Semua lapak' }, ...data.stalls.map(s => ({ value: s.id, label: s.name }))]} />
            <FilterSelect value={consignorFilter} onChange={setConsignorFilter} searchPlaceholder="Cari penitip…"
              options={[{ value: '', label: 'Semua penitip' }, ...data.consignors.map(c => ({ value: c.id, label: c.name }))]} />
            <button onClick={() => setOnlyInStock(v => !v)} aria-pressed={onlyInStock}
              className="px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0"
              style={{
                height: HEADER_BTN_H, flex: '0 0 auto',
                background: onlyInStock ? 'linear-gradient(135deg,#E8821A,#C96018)' : 'var(--surface-2)',
                color: onlyInStock ? 'white' : 'var(--text-muted)',
              }}>
              <PackageCheck size={14} /> <span className="hidden sm:inline">Ada Stok</span>
            </button>
          </>
        )}
        renderBody={l => (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{l.p.name}</p>
                <Badge tone="accent">{l.stall?.name ?? '?'}</Badge>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {l.c?.name ?? '—'} · jual {rupiah(l.eff.price)}{l.eff.share ? ` · penitip ${rupiah(l.eff.share.consignor)} · kita ${rupiah(l.eff.share.ours)}` : ' · skema belum ditentukan'}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold" style={{ color: l.item.stockQty > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{qtyText(l.item.stockQty)}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l.p.unit}</p>
            </div>
          </div>
        )}
        renderDetail={l => (
          <DetailPanel fields={[
            { label: 'Kode Produk', value: l.p.code },
            { label: 'Penitip', value: l.c?.name ?? '' },
            { label: 'Lapak', value: l.stall?.name ?? '' },
            { label: 'Stok', value: `${qtyText(l.item.stockQty)} ${l.p.unit}` },
            { label: 'Harga Jual', value: rupiah(l.eff.price) },
            { label: 'Skema Bagi Hasil', value: schemeText(l.eff.spec) },
            { label: 'Bagian Penitip / unit', value: l.eff.share ? rupiah(l.eff.share.consignor) : '' },
            { label: 'Bagian Kita / unit', value: l.eff.share ? rupiah(l.eff.share.ours) : '' },
            { label: 'Nilai Stok untuk Penitip', value: l.eff.share ? rupiah(l.item.stockQty * l.eff.share.consignor) : '' },
            { label: 'Potensi Bagian Kita', value: l.eff.share ? rupiah(l.item.stockQty * l.eff.share.ours) : '' },
          ]} />
        )}
        actions={l => (
          <Tooltip label="Riwayat stok">
            <button className="btn-ghost p-2" onClick={() => setHistory({ title: `${l.p.name} — ${l.stall?.name ?? ''}`, productId: l.item.productId, stallId: l.item.stallId })}>
              <History size={13} />
            </button>
          </Tooltip>
        )}
        exportCols={cols} exportTitle="STOK TITIP JUAL PER LAPAK" exportFile="stok-titip-jual"
      />

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
