'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Minus, Trash2, ShoppingCart, RefreshCw, History, Lock, Unlock, Printer, CheckCircle2, Loader2, Package, PackagePlus, ClipboardList, ScanLine, PauseCircle, MessageCircle } from 'lucide-react';
import Image from 'next/image';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import PageLoader from '@/components/PageLoader';
import ScrollChips from '@/components/ScrollChips';
import BarcodeScannerModal from '@/components/BarcodeScannerModal';
import { useConfirm } from '@/components/Confirm';
import { waLink, receiptMessage } from '@/lib/stall-whatsapp';
import { resolveStallScan } from './kasir-lapak/scan';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import { useToast } from '@/components/Toast';
import type { Action } from '@/types/rbac';
import { Badge, Field, ModalShell, ErrorBox, rupiah, qtyText } from './titip-jual/shared';
import ShiftModal from './kasir-lapak/ShiftModal';
import HistoryModal from './kasir-lapak/HistoryModal';
import ReceiveModal from './kasir-lapak/ReceiveModal';
import RekapModal from './kasir-lapak/RekapModal';
import { downloadSettlementPdf, type Settlement } from './titip-jual/settlementPdf';
import { toDataUri } from '@/lib/pdf/logo';
import Receipt from './kasir-lapak/Receipt';
import StallProductCard, { itemEmoji } from './kasir-lapak/ProductCard';
import { PAY_LABEL, itemKey, type PosStall, type CatalogItem, type Sale, type PaymentMethod } from './kasir-lapak/types';

type KindFilter = 'all' | 'consign' | 'own';
const KIND_TABS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Semua' }, { id: 'consign', label: 'Titipan' }, { id: 'own', label: 'Produk Toko' },
];
const STALL_KEY = 'kasirLapak:stall';
const heldKey = (stallId: string) => `kasirLapak:held:${stallId}`;

// Transaksi yang ditahan (disimpan di perangkat ini saja — bukan di server, tidak mengunci stok).
interface Held { id: string; at: number; cart: Record<string, number>; discount: string; method: PaymentMethod; note: string; customerName: string; customerPhone: string }
const readHeld = (stallId: string): Held[] => {
  try { return JSON.parse(window.localStorage.getItem(heldKey(stallId)) ?? '[]') as Held[]; } catch { return []; }
};

async function fetchStalls(creds: string): Promise<PosStall[]> {
  const r = await fetch('/api/stall-pos/stalls', { headers: { 'x-admin-auth': creds } });
  return r.ok ? ((await r.json()) as { stalls: PosStall[] }).stalls : [];
}
interface Catalog { stallId: string; items: CatalogItem[]; hasWarehouse: boolean }
async function fetchCatalog(creds: string, stallId: string): Promise<Catalog> {
  const r = await fetch(`/api/stall-pos/catalog?stallId=${stallId}`, { headers: { 'x-admin-auth': creds } });
  const d = r.ok ? await r.json() as { items: CatalogItem[]; hasWarehouse: boolean } : { items: [], hasWarehouse: false };
  return { stallId, ...d };
}

// Kasir Lapak: kasir khusus per lapak (data penjualan, stok, dan uang terpisah dari Kasir toko).
// Hanya menampilkan barang yang ada di lapak: titipan (stok titipan lapak) + produk toko (stok gudang terkait).
export default function KasirLapakTab({ creds, can }: { creds: string; can: (a: Action) => boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [store, setStore] = useState<{ name: string; address?: string; logo?: string; whatsapp?: string }>({ name: 'Cemilan Teh Risma' });
  const [stalls, setStalls] = useState<PosStall[] | null>(null);
  const [stallId, setStallId] = useState('');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paid, setPaid] = useState('');
  const [note, setNote] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [held, setHeld] = useState<Held[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Sale | null>(null);
  const [printSale, setPrintSale] = useState<Sale | null>(null);
  const [printedAt, setPrintedAt] = useState('');
  const [shiftModal, setShiftModal] = useState<'open' | 'close' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [rekapOpen, setRekapOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchStalls(creds).then(list => {
      if (!alive) return;
      setStalls(list);
      let saved = '';
      try { saved = window.localStorage.getItem(STALL_KEY) ?? ''; } catch { /* abaikan */ }
      setStallId(prev => [prev, saved].find(id => id && list.some(s => s.id === id)) ?? list[0]?.id ?? '');
    });
    return () => { alive = false; };
  }, [creds]);

  useEffect(() => {
    let alive = true;
    fetch('/api/stall-pos/store', { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<{ store: { name: string; address: string; logo: string; whatsapp: string } }> : null)
      .then(d => { if (alive && d) setStore(d.store); })
      .catch(() => {});
    return () => { alive = false; };
  }, [creds]);

  useEffect(() => {
    if (!stallId) return;
    let alive = true;
    Promise.resolve().then(() => { if (alive) setHeld(readHeld(stallId)); });
    fetchCatalog(creds, stallId).then(c => { if (alive) setCatalog(c); });
    return () => { alive = false; };
  }, [creds, stallId]);

  const reloadAll = useCallback(async () => {
    const [list, cat] = await Promise.all([fetchStalls(creds), stallId ? fetchCatalog(creds, stallId) : Promise.resolve(null)]);
    setStalls(list); if (cat) setCatalog(cat);
  }, [creds, stallId]);

  const stall = stalls?.find(s => s.id === stallId) ?? null;
  const items = catalog && catalog.stallId === stallId ? catalog.items : null;

  const changeStall = (id: string) => {
    setStallId(id); setCart({}); setCat(''); setDiscount(''); setPaid(''); setNote(''); setCustomerName(''); setCustomerPhone(''); setSearch(''); setCatalog(null);
    try { window.localStorage.setItem(STALL_KEY, id); } catch { /* abaikan */ }
  };

  const lines = Object.entries(cart).flatMap(([key, qty]) => {
    const item = items?.find(i => itemKey(i.kind, i.productId) === key);
    return item ? [{ key, item, qty }] : [];
  });
  const subtotal = lines.reduce((a, l) => a + l.item.price * l.qty, 0);
  const discountNum = Number(discount || 0);
  const total = Math.max(0, subtotal - discountNum);
  const paidNum = Number(paid || 0);
  const change = method === 'cash' ? paidNum - total : 0;
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const canPay = lines.length > 0 && !!stall?.shift && (method !== 'cash' || paidNum >= total);

  const add = (item: CatalogItem) => {
    if (item.blocked || item.stock <= 0) return;
    const key = itemKey(item.kind, item.productId);
    setCart(c => {
      const next = (c[key] ?? 0) + 1;
      if (next > item.stock) { toast.error(`Stok ${item.name} hanya ${qtyText(item.stock)}.`); return c; }
      return { ...c, [key]: next };
    });
  };
  const setQty = (key: string, qty: number, max: number) => setCart(c => {
    if (qty <= 0) { const { [key]: _removed, ...rest } = c; void _removed; return rest; }
    return { ...c, [key]: Math.min(qty, max) };
  });

  const pay = async () => {
    if (!stall) return;
    setProcessing(true); setError('');
    const r = await fetch('/api/stall-pos/sales', {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stallId: stall.id, discount: discountNum, paymentMethod: method, amountPaid: method === 'cash' ? paidNum : total, note, customerName, customerPhone,
        items: lines.map(l => ({ kind: l.item.kind, productId: l.item.productId, qty: l.qty })),
      }),
    });
    const d = await r.json().catch(() => ({})) as { sale?: Sale; error?: string };
    if (r.ok && d.sale) {
      setDone(d.sale); setCart({}); setDiscount(''); setPaid(''); setNote(''); setCustomerName(''); setCustomerPhone(''); setCartOpen(false);
      await reloadAll();
    } else {
      const msg = d.error ?? 'Gagal menyimpan transaksi.';
      setError(msg); toast.error(msg);
    }
    setProcessing(false);
  };

  const saveHeld = (list: Held[]) => {
    setHeld(list);
    try { window.localStorage.setItem(heldKey(stallId), JSON.stringify(list)); } catch { /* abaikan */ }
  };
  const resetCart = () => { setCart({}); setDiscount(''); setPaid(''); setNote(''); setCustomerName(''); setCustomerPhone(''); setError(''); };
  const holdCurrent = () => {
    if (lines.length === 0) return;
    saveHeld([{ id: String(Date.now()), at: Date.now(), cart, discount, method, note, customerName, customerPhone }, ...held]);
    resetCart(); setCartOpen(false);
    toast.success('Transaksi ditahan. Lanjutkan lewat tombol "Tertahan".');
  };
  const resumeHeld = (h: Held) => {
    if (lines.length > 0) { toast.error('Keranjang masih berisi barang — tahan atau kosongkan dulu.'); return; }
    // Stok bisa berubah sejak ditahan: barang yang sudah tidak ada dibuang, jumlah dibatasi stok sekarang.
    const next: Record<string, number> = {};
    for (const [key, qty] of Object.entries(h.cart)) {
      const it = items?.find(i => itemKey(i.kind, i.productId) === key);
      if (it && !it.blocked && it.stock > 0) next[key] = Math.min(qty, it.stock);
    }
    if (Object.keys(next).length === 0) { toast.error('Barang di transaksi ini sudah tidak tersedia.'); return; }
    setCart(next); setDiscount(h.discount); setMethod(h.method); setNote(h.note); setCustomerName(h.customerName); setCustomerPhone(h.customerPhone);
    saveHeld(held.filter(x => x.id !== h.id)); setHeldOpen(false);
    if (Object.keys(next).length < Object.keys(h.cart).length) toast.error('Sebagian barang sudah habis/tidak tersedia dan dikeluarkan dari keranjang.');
  };
  const dropHeld = async (h: Held) => {
    if (!await confirm({ message: 'Hapus transaksi tertahan ini?', danger: true })) return;
    saveHeld(held.filter(x => x.id !== h.id));
  };
  const handleScan = (text: string) => {
    const it = items ? resolveStallScan(text, items) : null;
    if (!stall?.shift) return { ok: false, label: 'Buka kasir dulu' };
    if (!it) return { ok: false, label: `Tidak dikenali: ${text.slice(0, 40)}` };
    if (it.blocked) return { ok: false, label: `${it.name}: ${it.blocked}` };
    if (it.stock <= 0) return { ok: false, label: `${it.name}: stok habis` };
    add(it);
    return { ok: true, label: `${it.name} ditambahkan` };
  };

  const print = (s: Sale) => {
    setPrintSale(s);
    setPrintedAt(new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    setTimeout(() => window.print(), 0);
  };

  if (stalls === null) return <PageLoader />;
  if (stalls.length === 0) {
    return (
      <div className="p-4 lg:p-6">
        <div className="card py-12 px-6 text-center space-y-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Belum ada lapak untuk akun ini</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Minta admin menugaskan Anda ke sebuah lapak (menu Titip Jual → Lapak → Petugas).</p>
        </div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const categories = [...new Set((items ?? []).map(i => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'id'));
  const shown = (items ?? []).filter(i => (kind === 'all' || i.kind === kind) && (!cat || i.category === cat) && (!q || `${i.name} ${i.code} ${i.consignorName ?? ''}`.toLowerCase().includes(q)));

  const checkout = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {lines.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Keranjang kosong. Ketuk barang untuk menambah.</p>
      ) : lines.map(l => (
        <div key={l.key} className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 relative" style={{ background: 'var(--surface-2)' }}>
            {l.item.imageUrl
              ? <Image src={l.item.imageUrl} alt={l.item.name} fill className="object-contain" sizes="40px" unoptimized />
              : <div className="w-full h-full flex items-center justify-center text-lg">{itemEmoji(l.item)}</div>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{l.item.name}</p>
            <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>{rupiah(l.item.price)} / {l.item.unit}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              onClick={() => setQty(l.key, l.qty - 1, l.item.stock)}><Minus size={11} strokeWidth={2.5} /></button>
            <span className="w-6 text-center text-sm font-black tabular">{qtyText(l.qty)}</span>
            <button className="w-7 h-7 rounded-full text-white flex items-center justify-center disabled:opacity-40" style={{ background: 'var(--accent)' }}
              onClick={() => setQty(l.key, l.qty + 1, l.item.stock)} disabled={l.qty >= l.item.stock}><Plus size={11} strokeWidth={2.5} /></button>
          </div>
          <span className="text-sm font-bold tabular w-20 text-right flex-shrink-0" style={{ color: 'var(--accent-dark)' }}>{rupiah(l.item.price * l.qty)}</span>
          <button className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ color: 'var(--danger)' }}
            onClick={() => setQty(l.key, 0, l.item.stock)}><Trash2 size={13} /></button>
        </div>
      ))}

      {lines.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <button onClick={holdCurrent} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--accent)' }}><PauseCircle size={13} /> Tahan transaksi</button>
            <button onClick={resetCart} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--danger)' }}><Trash2 size={12} /> Kosongkan</button>
          </div>
          <Field label="Diskon (Rp, ditanggung toko)">
            <NumberInput value={discount} placeholder="0" onChange={setDiscount} />
          </Field>
          <div className="flex gap-2">
            {(Object.keys(PAY_LABEL) as PaymentMethod[]).map(m => (
              <button key={m} onClick={() => setMethod(m)} className="flex-1 px-3 py-2 rounded-xl text-xs font-bold"
                style={method === m ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                {PAY_LABEL[m]}
              </button>
            ))}
          </div>
          {method === 'cash' && (
            <Field label="Uang diterima (Rp)">
              <NumberInput value={paid} placeholder="0" onChange={setPaid} />
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {[total, 20000, 50000, 100000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v, i) => (
                  <button key={v} onClick={() => setPaid(String(v))} className="btn-ghost text-[11px] px-2.5 py-1">{i === 0 ? 'Uang pas' : rupiah(v)}</button>
                ))}
              </div>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nama pelanggan">
              <input className="input" value={customerName} maxLength={80} placeholder="opsional" onChange={e => setCustomerName(e.target.value)} />
            </Field>
            <Field label="WhatsApp pelanggan">
              <input className="input" value={customerPhone} maxLength={20} inputMode="tel" placeholder="untuk kirim struk" onChange={e => setCustomerPhone(e.target.value)} />
            </Field>
          </div>
          <Field label="Catatan (opsional)">
            <input className="input" value={note} maxLength={200} onChange={e => setNote(e.target.value)} />
          </Field>
          <div className="card p-3 space-y-1" style={{ background: 'var(--surface-2)' }}>
            <div className="flex justify-between text-xs"><span style={{ color: 'var(--text-muted)' }}>Subtotal ({qtyText(count)} barang)</span><span>{rupiah(subtotal)}</span></div>
            {discountNum > 0 && <div className="flex justify-between text-xs"><span style={{ color: 'var(--text-muted)' }}>Diskon</span><span>-{rupiah(discountNum)}</span></div>}
            <div className="flex justify-between text-base font-bold"><span>Total</span><span style={{ color: 'var(--accent)' }}>{rupiah(total)}</span></div>
            {method === 'cash' && paidNum > 0 && (
              <div className="flex justify-between text-xs"><span style={{ color: 'var(--text-muted)' }}>{change >= 0 ? 'Kembalian' : 'Kurang'}</span>
                <b style={{ color: change >= 0 ? '#059669' : 'var(--danger)' }}>{rupiah(Math.abs(change))}</b></div>
            )}
          </div>
          <ErrorBox message={error} />
        </>
      )}
    </div>
  );

  const payButton = (
    <button onClick={pay} disabled={!canPay || processing} className="btn-primary w-full" style={{ justifyContent: 'center', padding: '12px 0' }}>
      {processing ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />} Bayar {total > 0 ? rupiah(total) : ''}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Refresh">
          <button onClick={() => { reloadAll(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center"><RefreshCw size={14} /></button>
        </Tooltip>
      </TopbarPortal>

      {/* Lapak aktif + status shift */}
      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="card px-3 sm:px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <div className="flex-1 min-w-[200px] sm:flex-none sm:w-64">
            {stalls.length > 1 ? (
              <SearchSelect value={stallId} onChange={changeStall} placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…"
                options={stalls.map(s => ({ value: s.id, label: s.name, sublabel: s.code }))} />
            ) : (
              <div className="flex items-center gap-2 min-w-0"><Badge tone="accent">{stall?.code}</Badge><b className="text-sm truncate">{stall?.name}</b></div>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs min-w-0">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: stall?.shift ? '#059669' : 'var(--danger)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>
              {stall?.shift ? <>Kasir buka · kas awal <b>{rupiah(stall.shift.openingBalance)}</b></> : 'Kasir belum dibuka'}
            </span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {can('create') && <button onClick={() => setReceiveOpen(true)} className="btn-ghost text-xs" style={{ height: 34 }}><PackagePlus size={13} /> <span className="hidden sm:inline">Terima Barang</span></button>}
            {held.length > 0 && (
              <button onClick={() => setHeldOpen(true)} className="btn-ghost text-xs relative" style={{ height: 34 }}>
                <PauseCircle size={13} /> <span className="hidden sm:inline">Tertahan</span>
                <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-black flex items-center justify-center" style={{ background: 'var(--accent)' }}>{held.length}</span>
              </button>
            )}
            <button onClick={() => setRekapOpen(true)} className="btn-ghost text-xs" style={{ height: 34 }}><ClipboardList size={13} /> <span className="hidden sm:inline">Rekap</span></button>
            <button onClick={() => setHistoryOpen(true)} className="btn-ghost text-xs" style={{ height: 34 }}><History size={13} /> <span className="hidden sm:inline">Riwayat</span></button>
            {stall?.shift ? (
              <button onClick={() => setShiftModal('close')} className="btn-ghost text-xs" style={{ height: 34, color: 'var(--danger)' }}><Lock size={13} /> Tutup Kasir</button>
            ) : (
              <button onClick={() => setShiftModal('open')} className="btn-primary text-xs" style={{ height: 34 }}><Unlock size={13} /> Buka Kasir</button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden lg:grid" style={{ gridTemplateColumns: '1fr 400px' }}>
        {/* Katalog */}
        <div className="h-full overflow-y-auto thin-scrollbar p-4 lg:p-6 pb-28 lg:pb-6 space-y-4" style={{ borderRight: '1px solid var(--border)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative flex-1 min-w-0 flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input className="input text-sm w-full" style={{ paddingLeft: 38, height: 34 }} placeholder="Cari barang atau penitip…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Tooltip label="Scan barcode / QR produk">
                <button onClick={() => setScanOpen(true)} disabled={!stall?.shift} className="btn-ghost p-0 flex items-center justify-center flex-shrink-0 disabled:opacity-40" style={{ height: 34, width: 34 }}><ScanLine size={15} /></button>
              </Tooltip>
            </div>
            <div className="inline-flex rounded-xl overflow-x-auto no-scrollbar border self-start" style={{ borderColor: 'var(--border)' }}>
              {KIND_TABS.map(t => (
                <button key={t.id} onClick={() => setKind(t.id)} className="px-3.5 py-2 text-xs font-bold whitespace-nowrap"
                  style={kind === t.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>{t.label}</button>
              ))}
            </div>
          </div>

          {categories.length > 0 && (
            <ScrollChips gap="gap-2">
              {['', ...categories].map(c => (
                <button key={c || 'all'} onClick={() => setCat(c)} className={`tab-chip ${cat === c ? 'active' : ''}`}>{c || 'Semua kategori'}</button>
              ))}
            </ScrollChips>
          )}

          {!stall?.shift && (
            <p className="text-xs px-3 py-2 rounded-xl" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              Buka kasir dulu untuk mulai berjualan di <b>{stall?.name}</b>. Barang di bawah baru bisa ditambahkan ke keranjang setelah kasir dibuka.
            </p>
          )}

          {items === null ? <PageLoader /> : shown.length === 0 ? (
            <div className="card py-12 text-center space-y-1">
              <Package size={22} className="mx-auto" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {items.length === 0 ? 'Belum ada barang di lapak ini. Catat penerimaan barang titipan di Titip Jual → Terima & Retur.' : 'Tidak ada barang yang cocok.'}
              </p>
              {items.length === 0 && catalog && !catalog.hasWarehouse && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Produk toko baru tampil jika lapak punya gudang terkait.</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {shown.map(i => {
                const key = itemKey(i.kind, i.productId);
                return (
                  <StallProductCard key={key} item={i} qty={cart[key] ?? 0} disabled={!stall?.shift}
                    onAdd={() => add(i)} onMinus={() => setQty(key, (cart[key] ?? 0) - 1, i.stock)} />
                );
              })}
            </div>
          )}
        </div>

        {/* Keranjang (desktop) */}
        <div className="hidden lg:flex flex-col h-full overflow-hidden">
          <div className="px-5 pt-5 pb-2 flex items-center gap-2"><ShoppingCart size={16} /><p className="text-sm font-bold">Keranjang</p></div>
          <div className="flex-1 overflow-y-auto thin-scrollbar px-5 pb-4">{checkout}</div>
          <div className="p-4" style={{ borderTop: '1px solid var(--border)' }}>{payButton}</div>
        </div>
      </div>

      {/* Bar keranjang (HP) */}
      {count > 0 && (
        <button onClick={() => setCartOpen(true)} className="lg:hidden fixed left-4 right-4 bottom-20 z-30 btn-primary flex items-center justify-between"
          style={{ padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
          <span className="flex items-center gap-2"><ShoppingCart size={16} /> {qtyText(count)} barang</span>
          <span className="font-bold">{rupiah(subtotal)}</span>
        </button>
      )}
      {cartOpen && (
        <ModalShell title="Keranjang" subtitle={stall?.name} icon={<ShoppingCart size={17} />} onClose={() => setCartOpen(false)} footer={payButton}>
          {checkout}
        </ModalShell>
      )}

      {shiftModal && stall && (
        <ShiftModal creds={creds} stall={stall} mode={shiftModal} onClose={() => setShiftModal(null)}
          onDone={async () => { setShiftModal(null); await reloadAll(); }} />
      )}
      {receiveOpen && stall && (
        <ReceiveModal creds={creds} stall={stall} items={items ?? []} onClose={() => setReceiveOpen(false)} onDone={reloadAll} />
      )}
      {rekapOpen && stall && (
        <RekapModal creds={creds} stall={stall} canCreate={can('create')} ownerPhone={store.whatsapp} storeName={store.name} onClose={() => setRekapOpen(false)}
          onPdf={async (s: Settlement) => downloadSettlementPdf(s, { name: store.name, address: store.address, logo: await toDataUri(store.logo) })} />
      )}
      {historyOpen && stall && (
        <HistoryModal creds={creds} stall={stall} canVoid={can('delete')} onClose={() => setHistoryOpen(false)} onChanged={reloadAll} onPrint={print} />
      )}

      {done && (
        <ModalShell title="Transaksi Berhasil" subtitle={done.invoiceNo} icon={<CheckCircle2 size={17} />} onClose={() => setDone(null)}
          footer={(
            <>
              <button onClick={() => print(done)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}><Printer size={14} /> Cetak</button>
              <button onClick={() => {
                if (!done.customerPhone) toast.error('Nomor WhatsApp pelanggan tidak diisi — pilih kontaknya manual di WhatsApp.');
                window.open(waLink(done.customerPhone, receiptMessage(done, store.name, done.customerName || undefined)), '_blank', 'noopener');
              }} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0', color: '#059669' }}><MessageCircle size={14} /> WhatsApp</button>
              <button onClick={() => setDone(null)} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Transaksi Baru</button>
            </>
          )}>
          <div className="text-center space-y-1 py-2">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{rupiah(done.total)}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{PAY_LABEL[done.paymentMethod]}{done.paymentMethod === 'cash' ? ` · diterima ${rupiah(done.amountPaid)}` : ''}</p>
            {done.paymentMethod === 'cash' && <p className="text-lg font-bold" style={{ color: '#059669' }}>Kembalian {rupiah(done.changeAmount)}</p>}
          </div>
        </ModalShell>
      )}

      {heldOpen && (
        <ModalShell title="Transaksi Tertahan" subtitle={`${stall?.name ?? ''} · tersimpan di perangkat ini`} icon={<PauseCircle size={17} />} onClose={() => setHeldOpen(false)}
          footer={<button onClick={() => setHeldOpen(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>}>
          {held.length === 0 ? <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Tidak ada transaksi tertahan.</p> : held.map((h, idx) => {
            const n = Object.values(h.cart).reduce((a, q) => a + q, 0);
            const sum = Object.entries(h.cart).reduce((a, [k, q]) => a + q * (items?.find(i => itemKey(i.kind, i.productId) === k)?.price ?? 0), 0);
            return (
              <div key={h.id} className="flex items-center gap-3 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{h.customerName || 'Tanpa nama'} · {qtyText(n)} barang</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(h.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · ± {rupiah(sum)}</p>
                </div>
                <button onClick={() => resumeHeld(h)} className="btn-primary text-xs flex-shrink-0" style={{ height: 32 }}>Lanjutkan</button>
                <button onClick={() => dropHeld(h)} className="btn-ghost p-2 flex-shrink-0" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
              </div>
            );
          })}
        </ModalShell>
      )}
      {scanOpen && (
        <BarcodeScannerModal title="Scan Barang" subtitle="Setiap kode yang terbaca langsung masuk keranjang" onDetect={handleScan} onClose={() => setScanOpen(false)} />
      )}

      {printSale && <Receipt sale={printSale} store={store} printedAt={printedAt} />}
    </div>
  );
}
