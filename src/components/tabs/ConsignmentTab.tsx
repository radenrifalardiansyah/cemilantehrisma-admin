'use client';

import { useState, useEffect } from 'react';
import {
  Store, Send, ClipboardList, Plus, Pencil, Trash2, X, Loader2, RefreshCw,
  Clock, AlertTriangle, Phone, MapPin, StickyNote,
} from 'lucide-react';
import TopbarPortal from '@/components/TopbarPortal';
import SearchSelect from '@/components/SearchSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import type { PosProduct } from '@/lib/pos-types';

const API = '';

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

function formatDate(seconds?: number) {
  if (!seconds) return '–';
  return new Date(seconds * 1000).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

type SubTab = 'lokasi' | 'kirim' | 'rekap';
const SUB_TABS: { id: SubTab; label: string; Icon: React.ElementType }[] = [
  { id: 'lokasi', label: 'Lokasi',      Icon: Store },
  { id: 'kirim',  label: 'Kirim Stok',  Icon: Send },
  { id: 'rekap',  label: 'Rekap Harian', Icon: ClipboardList },
];

interface ConsignmentLocation {
  id: string; name: string; contactName: string; contactPhone: string; address: string; note: string;
}
type LocationForm = { name: string; contactName: string; contactPhone: string; address: string; note: string };
const EMPTY_LOCATION: LocationForm = { name: '', contactName: '', contactPhone: '', address: '', note: '' };

interface ConsignmentStockItem { productId: string; productName: string; stockQty: number; hargaTitip: number }

interface ShipmentItem { productName: string; qty: number; hargaTitip: number; subtotal: number }
interface Shipment { id: string; locationName: string; items: ShipmentItem[]; note?: string; createdAt?: { seconds: number } }

interface RecapItem { productName: string; qtySold: number; qtyRetur: number; hargaTitip: number; revenue: number }
interface Recap {
  id: string; locationName: string; items: RecapItem[];
  totalSold: number; totalRetur: number; totalRevenue: number; note?: string;
  paymentStatus?: 'lunas' | 'belum_lunas'; createdAt?: { seconds: number };
}

interface SendRow { productId: string; qty: string; hargaTitip: string }
const EMPTY_SEND_ROW: SendRow = { productId: '', qty: '', hargaTitip: '' };

export default function ConsignmentTab({ creds, products }: { creds: string; products: PosProduct[] }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };

  const [subTab, setSubTab] = useState<SubTab>('lokasi');

  // ── Lokasi ───────────────────────────────────────────────────
  const [locations,        setLocations]        = useState<ConsignmentLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationStock,    setLocationStock]    = useState<Record<string, ConsignmentStockItem[]>>({});
  const [showLForm,   setShowLForm]   = useState(false);
  const [editingL,    setEditingL]    = useState<ConsignmentLocation | null>(null);
  const [lForm,       setLForm]       = useState<LocationForm>(EMPTY_LOCATION);
  const [savingL,     setSavingL]     = useState(false);
  const [deletingLId, setDeletingLId] = useState<string | null>(null);

  const loadLocations = async () => {
    setLocationsLoading(true);
    const r = await fetch(`${API}/api/consignment/locations`, { headers });
    if (r.ok) {
      const { locations: ls } = await r.json() as { locations: ConsignmentLocation[] };
      setLocations(ls);
      const entries = await Promise.all(ls.map(async l => {
        const sr = await fetch(`${API}/api/consignment/locations/${l.id}/stock`, { headers });
        const stock = sr.ok ? (await sr.json() as { stock: ConsignmentStockItem[] }).stock : [];
        return [l.id, stock] as const;
      }));
      setLocationStock(Object.fromEntries(entries));
    }
    setLocationsLoading(false);
  };
  useEffect(() => { loadLocations(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateL = () => { setEditingL(null); setLForm(EMPTY_LOCATION); setShowLForm(true); };
  const openEditL = (l: ConsignmentLocation) => {
    setEditingL(l); setLForm({ name: l.name, contactName: l.contactName, contactPhone: l.contactPhone, address: l.address, note: l.note }); setShowLForm(true);
  };
  const saveLocation = async () => {
    if (!lForm.name.trim()) return;
    setSavingL(true);
    const r = editingL
      ? await fetch(`${API}/api/consignment/locations/${editingL.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(lForm) })
      : await fetch(`${API}/api/consignment/locations`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(lForm) });
    if (r.ok) { await loadLocations(); setShowLForm(false); toast.success(editingL ? 'Lokasi berhasil diperbarui.' : 'Lokasi berhasil ditambahkan.'); }
    else toast.error('Gagal menyimpan lokasi.');
    setSavingL(false);
  };
  const deleteLocation = async (l: ConsignmentLocation) => {
    if (!await confirm({ message: `Hapus lokasi "${l.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingLId(l.id);
    const r = await fetch(`${API}/api/consignment/locations/${l.id}`, { method: 'DELETE', headers });
    if (r.ok) { setLocations(prev => prev.filter(x => x.id !== l.id)); toast.success(`"${l.name}" berhasil dihapus.`); }
    else toast.error('Gagal menghapus lokasi.');
    setDeletingLId(null);
  };

  // ── Kirim Stok ───────────────────────────────────────────────
  const [sendLocationId, setSendLocationId] = useState('');
  const [sendRows,       setSendRows]       = useState<SendRow[]>([{ ...EMPTY_SEND_ROW }]);
  const [sendNote,       setSendNote]       = useState('');
  const [sending,        setSending]        = useState(false);
  const [shipments,        setShipments]        = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(true);

  const loadShipments = async () => {
    setShipmentsLoading(true);
    const r = await fetch(`${API}/api/consignment/send?limit=50`, { headers });
    if (r.ok) setShipments((await r.json() as { shipments: Shipment[] }).shipments);
    setShipmentsLoading(false);
  };
  useEffect(() => { loadShipments(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addSendRow    = () => setSendRows(prev => [...prev, { ...EMPTY_SEND_ROW }]);
  const removeSendRow = (i: number) => setSendRows(prev => prev.filter((_, idx) => idx !== i));
  const updateSendRow = (i: number, patch: Partial<SendRow>) => setSendRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const sendTotal = sendRows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.hargaTitip) || 0), 0);
  const canSubmitSend = !!sendLocationId && sendRows.some(r => r.productId && (parseFloat(r.qty) || 0) > 0 && (parseFloat(r.hargaTitip) || 0) > 0);

  const submitSend = async () => {
    if (!canSubmitSend) return;
    setSending(true);
    try {
      const location = locations.find(l => l.id === sendLocationId)!;
      const items = sendRows
        .filter(r => r.productId && (parseFloat(r.qty) || 0) > 0 && (parseFloat(r.hargaTitip) || 0) > 0)
        .map(r => {
          const p = products.find(pp => pp.id === r.productId)!;
          return { productId: p.id, productName: p.name, qty: parseFloat(r.qty) || 0, hargaTitip: parseFloat(r.hargaTitip) || 0 };
        });
      const res = await fetch(`${API}/api/consignment/send`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: location.id, locationName: location.name, items, note: sendNote }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal menyimpan pengiriman.'); return; }
      toast.success(`Stok berhasil dikirim ke "${location.name}".`);
      setSendLocationId(''); setSendRows([{ ...EMPTY_SEND_ROW }]); setSendNote('');
      await Promise.all([loadShipments(), loadLocations()]);
    } finally { setSending(false); }
  };

  // ── Rekap Harian ─────────────────────────────────────────────
  const [recapLocationId,   setRecapLocationId]   = useState('');
  const [recapStock,        setRecapStock]        = useState<ConsignmentStockItem[]>([]);
  const [recapStockLoading, setRecapStockLoading] = useState(false);
  const [recapInputs,       setRecapInputs]       = useState<Record<string, { sold: string; retur: string }>>({});
  const [recapNote,         setRecapNote]         = useState('');
  const [recapPaymentStatus, setRecapPaymentStatus] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [submittingRecap,   setSubmittingRecap]   = useState(false);
  const [recaps,        setRecaps]        = useState<Recap[]>([]);
  const [recapsLoading, setRecapsLoading] = useState(true);
  const [markingRecapId, setMarkingRecapId] = useState<string | null>(null);

  const loadRecaps = async () => {
    setRecapsLoading(true);
    const r = await fetch(`${API}/api/consignment/recap?limit=50`, { headers });
    if (r.ok) setRecaps((await r.json() as { recaps: Recap[] }).recaps);
    setRecapsLoading(false);
  };
  useEffect(() => { loadRecaps(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRecapStock = async (locationId: string) => {
    setRecapStockLoading(true);
    setRecapInputs({});
    if (!locationId) { setRecapStock([]); setRecapStockLoading(false); return; }
    const r = await fetch(`${API}/api/consignment/locations/${locationId}/stock`, { headers });
    setRecapStock(r.ok ? (await r.json() as { stock: ConsignmentStockItem[] }).stock : []);
    setRecapStockLoading(false);
  };

  const recapRows = recapStock.map(item => {
    const input = recapInputs[item.productId] ?? { sold: '', retur: '' };
    const sold  = parseFloat(input.sold)  || 0;
    const retur = parseFloat(input.retur) || 0;
    const sisa  = item.stockQty - sold - retur;
    return { item, sold, retur, sisa, exceeds: sold + retur > item.stockQty };
  });
  const recapTotalRevenue = recapRows.reduce((s, r) => s + r.sold * r.item.hargaTitip, 0);
  const recapHasExceeds   = recapRows.some(r => r.exceeds);
  const canSubmitRecap    = !!recapLocationId && recapRows.some(r => r.sold > 0 || r.retur > 0) && !recapHasExceeds;

  const submitRecap = async () => {
    if (!canSubmitRecap) return;
    setSubmittingRecap(true);
    try {
      const location = locations.find(l => l.id === recapLocationId)!;
      const items = recapRows
        .filter(r => r.sold > 0 || r.retur > 0)
        .map(r => ({ productId: r.item.productId, productName: r.item.productName, qtySold: r.sold, qtyRetur: r.retur }));
      const res = await fetch(`${API}/api/consignment/recap`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: location.id, locationName: location.name, items, note: recapNote,
          paymentStatus: recapPaymentStatus,
        }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Gagal menyimpan rekap.'); return; }
      toast.success(`Rekap tersimpan — pendapatan ${formatRp(recapTotalRevenue)} dari "${location.name}".`);
      setRecapNote(''); setRecapPaymentStatus('lunas');
      await Promise.all([loadRecapStock(recapLocationId), loadRecaps(), loadLocations()]);
    } finally { setSubmittingRecap(false); }
  };

  const markRecapLunas = async (id: string) => {
    setMarkingRecapId(id);
    const r = await fetch(`${API}/api/consignment/recap/${id}`, { method: 'PUT', headers });
    if (r.ok) { toast.success('Rekap ditandai lunas.'); await loadRecaps(); }
    else toast.error('Gagal menandai lunas.');
    setMarkingRecapId(null);
  };

  const locationOptions = locations.map(l => ({ value: l.id, label: l.name }));
  const productOptions  = products.map(p => ({ value: p.id, label: p.name, emoji: p.emoji }));
  const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <button onClick={() => { loadLocations(); loadShipments(); loadRecaps(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center" title="Refresh">
          <RefreshCw size={14} className={locationsLoading || shipmentsLoading || recapsLoading ? 'animate-spin' : ''} />
        </button>
      </TopbarPortal>

      <div className="flex-shrink-0 px-4 lg:px-6 pt-4">
        <div className="inline-flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-all"
              style={subTab === t.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
              <t.Icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {/* ════ LOKASI ═════════════════════════════════════════ */}
        {subTab === 'lokasi' && (
          <div className="p-4 lg:p-6 animate-fade-up">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Lokasi Konsinyasi</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{locations.length} lokasi titip jual</p>
              </div>
              <button onClick={openCreateL} className="btn-primary px-4 py-2 text-xs">
                <Plus size={13} /> Tambah Lokasi
              </button>
            </div>

            {locationsLoading && locations.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : locations.length === 0 ? (
              <div className="rounded-2xl p-14 text-center" style={{ border: '2px dashed var(--border)', background: 'var(--surface)' }}>
                <Store size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada lokasi konsinyasi</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tambahkan lapak/UMKM mitra untuk mulai kirim stok titip</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {locations.map(l => {
                  const stock = locationStock[l.id] ?? [];
                  const totalQty   = stock.reduce((s, it) => s + it.stockQty, 0);
                  const totalValue = stock.reduce((s, it) => s + it.stockQty * it.hargaTitip, 0);
                  return (
                    <div key={l.id} className="card overflow-hidden p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-bg)' }}>
                          <Store size={20} style={{ color: 'var(--accent)' }} />
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEditL(l)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} title="Edit">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => deleteLocation(l)} disabled={deletingLId === l.id} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} title="Hapus">
                            {deletingLId === l.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </div>
                      <p className="font-bold text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>{l.name}</p>
                      {l.contactName && (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{l.contactName}</p>
                      )}
                      {l.contactPhone && (
                        <div className="flex items-center gap-1 mt-1">
                          <Phone size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{l.contactPhone}</p>
                        </div>
                      )}
                      {l.address && (
                        <div className="flex items-center gap-1 mt-1">
                          <MapPin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{l.address}</p>
                        </div>
                      )}
                      {l.note && (
                        <div className="flex items-start gap-1 mt-1">
                          <StickyNote size={10} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.note}</p>
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-4 pt-3.5" style={{ borderTop: '1px solid var(--border-2)' }}>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Stok titip saat ini</span>
                        <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>
                          {totalQty} pcs · {formatRp(totalValue)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════ KIRIM STOK ═════════════════════════════════════ */}
        {subTab === 'kirim' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                  <Send size={17} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Kirim Stok Konsinyasi</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Stok toko berkurang, stok titip di lokasi bertambah</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={fieldLabel}>Lokasi Tujuan <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={sendLocationId} onChange={setSendLocationId} options={locationOptions}
                    placeholder="– Pilih Lokasi –" searchPlaceholder="Cari lokasi…" />
                </div>

                <div>
                  <label style={fieldLabel}>Produk Dikirim</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sendRows.map((row, i) => {
                      const qty = parseFloat(row.qty) || 0;
                      const harga = parseFloat(row.hargaTitip) || 0;
                      return (
                        <div key={i}>
                          <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', alignItems: 'center' }}>
                            <SearchSelect value={row.productId} onChange={id => updateSendRow(i, { productId: id })}
                              options={productOptions} placeholder="– Produk –" searchPlaceholder="Cari produk…" />
                            <input type="number" min="0" value={row.qty} onChange={e => updateSendRow(i, { qty: e.target.value })}
                              placeholder="Qty (pcs)" className="input" />
                            <input type="number" min="0" value={row.hargaTitip} onChange={e => updateSendRow(i, { hargaTitip: e.target.value })}
                              placeholder="Harga titip" className="input" />
                            <button onClick={() => removeSendRow(i)} disabled={sendRows.length === 1}
                              className="btn-ghost p-2 disabled:opacity-30" style={{ color: 'var(--danger)' }} title="Hapus baris">
                              <X size={14} />
                            </button>
                          </div>
                          {qty > 0 && harga > 0 && (
                            <p className="text-xs tabular mt-1" style={{ color: 'var(--text-muted)' }}>Subtotal: {formatRp(qty * harga)}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={addSendRow} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Produk
                  </button>
                </div>

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={sendNote} onChange={e => setSendNote(e.target.value)} placeholder="Catatan tambahan (opsional)" className="input" />
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Nilai Titip</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(sendTotal)}</span>
                </div>

                <button onClick={submitSend} disabled={sending || !canSubmitSend} className="btn-primary justify-center py-3 text-sm disabled:opacity-40">
                  {sending ? <><Loader2 size={15} className="animate-spin" /> Menyimpan…</> : <><Send size={15} /> Kirim Stok</>}
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                <Clock size={11} /> Riwayat Kirim ({shipments.length})
              </p>
              {shipmentsLoading && shipments.length === 0 ? (
                <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
              ) : shipments.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat pengiriman.</p>
              ) : (
                <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
                  {shipments.map(s => (
                    <div key={s.id} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.locationName}</p>
                        <span className="text-sm font-bold tabular" style={{ color: 'var(--accent)' }}>
                          {formatRp(s.items.reduce((sum, it) => sum + it.subtotal, 0))}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatDate(s.createdAt?.seconds)}</p>
                      <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {s.items.map(it => `${it.productName} (${it.qty} pcs)`).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════ REKAP HARIAN ═══════════════════════════════════ */}
        {subTab === 'rekap' && (
          <div className="p-4 lg:p-6 animate-fade-up space-y-5">
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                  <ClipboardList size={17} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Rekap Harian</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Catat qty terjual & retur — sisanya tetap tertahan di lokasi</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={fieldLabel}>Lokasi <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={recapLocationId}
                    onChange={id => { setRecapLocationId(id); loadRecapStock(id); }}
                    options={locationOptions} placeholder="– Pilih Lokasi –" searchPlaceholder="Cari lokasi…" />
                </div>

                {recapLocationId && (
                  recapStockLoading ? (
                    <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
                  ) : recapStock.length === 0 ? (
                    <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Tidak ada stok titip di lokasi ini.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {recapRows.map(({ item, sold, sisa, exceeds }) => (
                        <div key={item.productId} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{item.productName}</p>
                            <span className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                              Stok di lokasi: {item.stockQty} pcs · {formatRp(item.hargaTitip)}/pcs
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label style={fieldLabel}>Qty Terjual</label>
                              <input type="number" min="0" value={recapInputs[item.productId]?.sold ?? ''}
                                onChange={e => setRecapInputs(prev => ({ ...prev, [item.productId]: { sold: e.target.value, retur: prev[item.productId]?.retur ?? '' } }))}
                                placeholder="0" className="input" />
                            </div>
                            <div>
                              <label style={fieldLabel}>Qty Retur</label>
                              <input type="number" min="0" value={recapInputs[item.productId]?.retur ?? ''}
                                onChange={e => setRecapInputs(prev => ({ ...prev, [item.productId]: { sold: prev[item.productId]?.sold ?? '', retur: e.target.value } }))}
                                placeholder="0" className="input" />
                            </div>
                          </div>
                          <p className="text-xs mt-2 tabular" style={{ color: exceeds ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {exceeds
                              ? `Melebihi stok di lokasi (tersedia ${item.stockQty} pcs)`
                              : `Sisa tetap di lokasi: ${sisa} pcs${sold > 0 ? ` · Pendapatan: ${formatRp(sold * item.hargaTitip)}` : ''}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )
                )}

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={recapNote} onChange={e => setRecapNote(e.target.value)} placeholder="Catatan tambahan (opsional)" className="input" />
                </div>

                <div>
                  <label style={fieldLabel}>Status Pembayaran</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['lunas', 'belum_lunas'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setRecapPaymentStatus(s)}
                        className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                        style={recapPaymentStatus === s ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {s === 'lunas' ? 'Lunas' : 'Belum Lunas'}
                      </button>
                    ))}
                  </div>
                  {recapPaymentStatus === 'belum_lunas' && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      Belum ikut dihitung sebagai pendapatan di Laporan Keuangan sampai ditandai Lunas (mitra sudah setor).
                    </p>
                  )}
                </div>

                {recapTotalRevenue > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--success-bg)' }}>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Pendapatan</span>
                    <span className="text-lg font-extrabold tabular" style={{ color: 'var(--success)' }}>{formatRp(recapTotalRevenue)}</span>
                  </div>
                )}

                {recapHasExceeds && (
                  <p className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    <AlertTriangle size={12} /> Ada qty yang melebihi stok di lokasi — periksa kembali sebelum simpan.
                  </p>
                )}

                <button onClick={submitRecap} disabled={submittingRecap || !canSubmitRecap} className="btn-primary justify-center py-3 text-sm disabled:opacity-40">
                  {submittingRecap ? <><Loader2 size={15} className="animate-spin" /> Menyimpan…</> : <><ClipboardList size={15} /> Simpan Rekap</>}
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                <Clock size={11} /> Riwayat Rekap ({recaps.length})
              </p>
              {recapsLoading && recaps.length === 0 ? (
                <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
              ) : recaps.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat rekap.</p>
              ) : (
                <div className="card overflow-hidden divide-y" style={{ borderColor: 'var(--border-2)' }}>
                  {recaps.map(r => (
                    <div key={r.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.locationName}</p>
                          {r.paymentStatus === 'belum_lunas' && <span className="badge badge-amber">Belum Lunas</span>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-sm font-bold tabular" style={{ color: 'var(--success)' }}>{formatRp(r.totalRevenue)}</span>
                          {r.paymentStatus === 'belum_lunas' && (
                            <button onClick={() => markRecapLunas(r.id)} disabled={markingRecapId === r.id}
                              className="btn-ghost px-2.5 py-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                              {markingRecapId === r.id ? <Loader2 size={12} className="animate-spin" /> : 'Tandai Lunas'}
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(r.createdAt?.seconds)} · {r.totalSold} pcs terjual{r.totalRetur > 0 ? ` · ${r.totalRetur} pcs retur` : ''}
                      </p>
                      <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {r.items.map(it => `${it.productName} (jual ${it.qtySold}${it.qtyRetur > 0 ? `, retur ${it.qtyRetur}` : ''})`).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showLForm && (
        <div className="modal-overlay" onClick={() => !savingL && setShowLForm(false)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Store size={17} /></div>
                <div>
                  <p className="modal-title">{editingL ? 'Edit Lokasi' : 'Tambah Lokasi Baru'}</p>
                  <p className="modal-subtitle">{editingL ? 'Perbarui informasi lokasi' : 'Isi detail lapak/UMKM mitra'}</p>
                </div>
              </div>
              <button onClick={() => setShowLForm(false)} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="field-label">Nama Lokasi <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input type="text" value={lForm.name} onChange={e => setLForm({ ...lForm, name: e.target.value })}
                    placeholder="cth: Warung Bu Yanti" autoFocus className="input" />
                </div>
                <div>
                  <label className="field-label">Nama Kontak</label>
                  <input type="text" value={lForm.contactName} onChange={e => setLForm({ ...lForm, contactName: e.target.value })}
                    placeholder="cth: Bu Yanti" className="input" />
                </div>
                <div>
                  <label className="field-label">Telepon</label>
                  <input type="tel" value={lForm.contactPhone} onChange={e => setLForm({ ...lForm, contactPhone: e.target.value })}
                    placeholder="cth: 08123456789" className="input" />
                </div>
                <div>
                  <label className="field-label">Alamat</label>
                  <input type="text" value={lForm.address} onChange={e => setLForm({ ...lForm, address: e.target.value })}
                    placeholder="cth: Jl. Melati No. 3" className="input" />
                </div>
                <div>
                  <label className="field-label">Catatan</label>
                  <textarea rows={3} value={lForm.note} onChange={e => setLForm({ ...lForm, note: e.target.value })}
                    placeholder="Catatan tambahan (opsional)" className="input resize-none" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowLForm(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={saveLocation} disabled={savingL || !lForm.name.trim()} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {savingL ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {savingL ? 'Menyimpan…' : editingL ? 'Simpan Perubahan' : 'Tambah Lokasi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
