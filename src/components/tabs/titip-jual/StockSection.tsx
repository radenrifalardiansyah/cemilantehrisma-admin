'use client';

import { useState, useEffect } from 'react';
import { History, PackageCheck, Store, Package, Wallet, TrendingUp, TrendingDown, MapPin, ChevronRight, ArrowLeft, Search, Plus, ImageIcon, Loader2 } from 'lucide-react';
import { ExcelIcon, PdfIcon } from '@/components/FileTypeIcons';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import ScrollChips from '@/components/ScrollChips';
import ImageCarousel from '@/components/ImageCarousel';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useToast } from '@/components/Toast';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';
import { exportExcel, exportPdf, type ExportCol } from './exporters';
import {
  API, HEADER_BTN_H, Badge, ModalShell, rupiah, qtyText, effectiveFor,
  type SectionProps, type CProduct, type Consignor, type Stall, type StallItem,
} from './shared';

interface LedgerEntry {
  id: string; type: string; qty: number; balanceAfter: number; note: string; createdAt: { seconds: number } | null;
}

const TYPE_LABEL: Record<string, string> = { in: 'Terima barang', return: 'Retur ke penitip', void: 'Pembatalan', edit: 'Koreksi dokumen', sale: 'Terjual', transfer_in: 'Pindah masuk', transfer_out: 'Pindah keluar', adjust_opname: 'Opname', adjust_damage: 'Rusak', adjust_lost: 'Hilang', adjust_expired: 'Kadaluarsa', adjust_other: 'Penyesuaian' };

interface Line { item: StallItem; p: CProduct; c: Consignor | undefined; stall: Stall | undefined; eff: ReturnType<typeof effectiveFor> }

export default function StockSection({ creds, data, can, goTo }: SectionProps) {
  const toast = useToast();
  const storeHeader = useStoreHeader(creds);
  const [stallId, setStallId] = useState<string | null>(null);
  const [consignorFilter, setConsignorFilter] = useState('');
  const [search, setSearch] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
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

  const canReceive = can('create') && !!goTo;
  const stall = stallId ? stallById.get(stallId) : undefined;
  const sum = (ls: Line[]) => ({
    qty: ls.reduce((a, l) => a + l.item.stockQty, 0),
    owed: ls.reduce((a, l) => a + l.item.stockQty * (l.eff.share?.consignor ?? 0), 0),
    ours: ls.reduce((a, l) => a + l.item.stockQty * (l.eff.share?.ours ?? 0), 0),
    inStock: ls.filter(l => l.item.stockQty > 0).length,
  });

  const statCards = (items: { icon: React.ReactNode; label: string; val: string | number; color: string }[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {items.map((c, i) => (
        <div key={i} className="card p-4 flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: c.color }}>{c.icon}</div>
          <div className="min-w-0">
            <p className="text-lg font-extrabold tabular leading-none truncate" style={{ color: c.color }}>{c.val}</p>
            <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  );

  // ── Tingkat 1: daftar lapak (seperti daftar gudang) ──
  if (!stallId || !stall) {
    const tot = sum(all);
    return (
      <div className="animate-fade-up">
        {statCards([
          { icon: <Store size={16} />, label: 'Total Lapak', val: data.stalls.length, color: 'var(--accent)' },
          { icon: <Package size={16} />, label: 'Total Stok', val: qtyText(tot.qty), color: 'var(--success)' },
          { icon: <Wallet size={16} />, label: 'Nilai untuk Penitip', val: rupiah(tot.owed), color: '#0284C7' },
          { icon: <TrendingUp size={16} />, label: 'Potensi Bagian Kita', val: rupiah(tot.ours), color: '#A84F10' },
        ])}
        {data.stalls.length === 0 ? (
          <EmptyAddCard label="Terima Barang" onClick={canReceive ? () => goTo!('receipts') : undefined} hint="Belum ada lapak. Tambahkan lapak di tab Lapak." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.stalls.map(st => {
              const t = sum(all.filter(l => l.item.stallId === st.id));
              const count = all.filter(l => l.item.stallId === st.id).length;
              return (
                <div key={st.id} onClick={() => { setStallId(st.id); setSearch(''); setConsignorFilter(''); setOnlyInStock(false); }}
                  onMouseEnter={() => setHovered(st.id)} onMouseLeave={() => setHovered(null)}
                  className="card cursor-pointer overflow-hidden"
                  style={{ transition: 'box-shadow 0.18s, transform 0.18s', boxShadow: hovered === st.id ? '0 6px 24px rgba(0,0,0,0.09)' : '', transform: hovered === st.id ? 'translateY(-2px)' : '' }}>
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-bg)' }}>
                        <Store size={20} style={{ color: 'var(--accent)' }} />
                      </div>
                      <Badge tone="accent">{st.code}</Badge>
                    </div>
                    <p className="font-bold text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>{st.name}</p>
                    {st.address ? (
                      <div className="flex items-center gap-1 mt-1.5">
                        <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{st.address}</p>
                      </div>
                    ) : <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Tidak ada alamat</p>}
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{qtyText(t.qty)} pcs · {count} produk ({t.inStock} ada stok)</p>
                    <div className="flex items-center justify-between mt-4 pt-3.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                      <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Lihat Stok</span>
                      <ChevronRight size={14} style={{ color: 'var(--accent)' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Tingkat 2: stok satu lapak (kartu produk seperti stok gudang) ──
  const stallLines = all.filter(l => l.item.stallId === stallId);
  const t = sum(stallLines);
  const lowCount = stallLines.filter(l => l.item.stockQty <= 0 || (l.p.minStock > 0 && l.item.stockQty <= l.p.minStock)).length;
  const q = search.trim().toLowerCase();
  const consignorIds = [...new Set(stallLines.map(l => l.p.consignorId))];
  const visible = stallLines
    .filter(l => !consignorFilter || l.p.consignorId === consignorFilter)
    .filter(l => !onlyInStock || l.item.stockQty > 0)
    .filter(l => !q || `${l.p.name} ${l.p.code} ${l.c?.name ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => a.p.name.localeCompare(b.p.name, 'id', { sensitivity: 'base' }));

  const cols: ExportCol<Line>[] = [
    { header: 'Produk', width: '22%', bold: true, value: l => l.p.name },
    { header: 'Penitip', width: '16%', value: l => l.c?.name ?? '-' },
    { header: 'Stok', width: '8%', align: 'right', value: l => l.item.stockQty },
    { header: 'Satuan', width: '8%', value: l => l.p.unit },
    { header: 'Harga Jual', width: '12%', align: 'right', value: l => rupiah(l.eff.price) },
    { header: 'Bagian Penitip', width: '12%', align: 'right', value: l => l.eff.share ? rupiah(l.eff.share.consignor) : '-' },
    { header: 'Bagian Kita', width: '12%', align: 'right', value: l => l.eff.share ? rupiah(l.eff.share.ours) : '-' },
  ];
  const doExport = async (kind: 'xlsx' | 'pdf') => {
    if (visible.length === 0) { toast.error('Tidak ada baris stok untuk diexport.'); return; }
    setExporting(kind);
    try {
      if (kind === 'xlsx') await exportExcel(cols, visible, 'STOK TITIP JUAL PER LAPAK', stall.name, `stok-${stall.code}`);
      else await exportPdf(cols, visible, 'STOK TITIP JUAL PER LAPAK', stall.name, `stok-${stall.code}`, storeHeader);
      toast.success(`Berhasil export ${visible.length} baris stok ke ${kind === 'xlsx' ? 'Excel' : 'PDF'}.`);
    } catch { toast.error(`Gagal membuat file ${kind === 'xlsx' ? 'Excel' : 'PDF'}.`); }
    finally { setExporting(null); }
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-6">
        <Tooltip label="Kembali">
          <button onClick={() => setStallId(null)} className="btn-ghost p-2 flex-shrink-0"><ArrowLeft size={16} /></button>
        </Tooltip>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-extrabold truncate" style={{ color: 'var(--text-primary)' }}>{stall.name}</h2>
          {stall.address && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin size={10} style={{ color: 'var(--text-muted)' }} />
              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{stall.address}</p>
            </div>
          )}
        </div>
        <Tooltip label="Export Excel">
          <button onClick={() => doExport('xlsx')} disabled={!!exporting} className="btn-ghost p-2 flex-shrink-0">
            {exporting === 'xlsx' ? <Loader2 size={15} className="animate-spin" /> : <ExcelIcon size={16} />}
          </button>
        </Tooltip>
        <Tooltip label="Export PDF">
          <button onClick={() => doExport('pdf')} disabled={!!exporting} className="btn-ghost p-2 flex-shrink-0">
            {exporting === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <PdfIcon size={16} />}
          </button>
        </Tooltip>
        {canReceive && <button onClick={() => goTo!('receipts')} className="btn-primary text-xs flex-shrink-0" style={{ height: HEADER_BTN_H }}><Plus size={13} /> <span className="hidden sm:inline">Terima Barang</span></button>}
      </div>

      {statCards([
        { icon: <Package size={16} />, label: 'Jenis Produk', val: stallLines.length, color: 'var(--accent)' },
        { icon: <TrendingUp size={16} />, label: 'Total Unit', val: qtyText(t.qty), color: 'var(--success)' },
        { icon: <TrendingDown size={16} />, label: 'Stok Rendah/Habis', val: lowCount, color: 'var(--danger)' },
        { icon: <Wallet size={16} />, label: 'Nilai untuk Penitip', val: rupiah(t.owed), color: '#0284C7' },
      ])}

      {stallLines.length === 0 ? (
        <EmptyAddCard label="Terima Barang" onClick={canReceive ? () => goTo!('receipts') : undefined} hint="Belum ada stok di lapak ini. Catat barang yang diterima dari penitip di tab Terima & Retur." />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-0">
              <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input className="input text-sm w-full" style={{ paddingLeft: 38, height: HEADER_BTN_H }} placeholder="Cari produk atau penitip…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setOnlyInStock(v => !v)} aria-pressed={onlyInStock}
              className="px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0"
              style={{
                height: HEADER_BTN_H,
                background: onlyInStock ? 'linear-gradient(135deg,#E8821A,#C96018)' : 'var(--surface-2)',
                color: onlyInStock ? 'white' : 'var(--text-muted)',
              }}>
              <PackageCheck size={14} /> <span className="hidden sm:inline">Ada Stok</span>
            </button>
          </div>
          {consignorIds.length > 1 && (
            <ScrollChips className="mb-4">
              <button onClick={() => setConsignorFilter('')} className={`tab-chip text-xs py-1.5 ${consignorFilter === '' ? 'active' : ''}`}>Semua ({stallLines.length})</button>
              {consignorIds.map(id => (
                <button key={id} onClick={() => setConsignorFilter(id)} className={`tab-chip text-xs py-1.5 ${consignorFilter === id ? 'active' : ''}`}>
                  {consignorById.get(id)?.name ?? '?'} ({stallLines.filter(l => l.p.consignorId === id).length})
                </button>
              ))}
            </ScrollChips>
          )}

          {visible.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Tidak ada produk yang cocok.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {visible.map(l => {
                const qty = l.item.stockQty;
                const qtyStyle = qty <= 0
                  ? { bg: '#FEF2F2', color: '#DC2626', border: '#FECACA' }
                  : l.p.minStock > 0 && qty <= l.p.minStock
                    ? { bg: '#FDF0E6', color: '#A84F10', border: 'rgba(212,105,30,0.25)' }
                    : { bg: '#F0FDF4', color: '#15803D', border: '#D1FAE5' };
                return (
                  <div key={l.item.id} className="card overflow-hidden flex flex-col select-none">
                    <div className="relative w-full aspect-square" style={{ background: 'var(--surface-2)' }}>
                      <ImageCarousel imageUrls={l.p.imageUrl ? [l.p.imageUrl] : undefined} emoji="📦" alt={l.p.name} sizes="(max-width: 640px) 50vw, 200px" emojiClassName="text-4xl" />
                      <div className="absolute top-2 right-2 text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: qtyStyle.bg, color: qtyStyle.color, border: `1px solid ${qtyStyle.border}` }}>
                        {qtyText(qty)} {l.p.unit}
                      </div>
                      {!l.p.imageUrl && (
                        <div className="absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }} title="Belum ada foto">
                          <ImageIcon size={10} color="#fff" />
                        </div>
                      )}
                    </div>
                    <div className="px-3 pt-2 pb-3">
                      <p className="text-[11px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>{l.p.name}</p>
                      <p className="text-[10.5px] mt-1 truncate" style={{ color: 'var(--text-muted)' }}>{l.c?.name ?? '—'} · jual {rupiah(l.eff.price)}</p>
                      <p className="text-[10.5px] truncate" style={{ color: 'var(--text-muted)' }}>
                        {l.eff.share ? `penitip ${rupiah(l.eff.share.consignor)} · kita ${rupiah(l.eff.share.ours)}` : 'skema belum ditentukan'}
                      </p>
                      <div className="flex items-center justify-between gap-1.5 mt-1.5">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l.p.code}</span>
                        <Tooltip label="Riwayat stok">
                          <button className="btn-ghost p-1 flex-shrink-0" onClick={() => setHistory({ title: `${l.p.name} — ${stall.name}`, productId: l.item.productId, stallId: l.item.stallId })}>
                            <History size={12} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

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
