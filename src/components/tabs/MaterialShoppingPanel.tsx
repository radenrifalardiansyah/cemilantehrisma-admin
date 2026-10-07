'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Loader2, ShoppingCart, Check, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import EmptyAddCard from '@/components/EmptyAddCard';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const API = '';

interface ShoppingItem {
  id: string; materialId: string; materialName: string; unit: string;
  qty: number; price: number | null; note: string; checked: boolean;
  status: 'pending' | 'done'; purchaseId?: string; doneAt?: string;
}
interface Opt { value: string; label: string; sublabel?: string }

interface Props {
  creds: string;
  materials: { id: string; name: string; unit: string; stockQty: number }[];
  suppliers: { id: string; name: string }[];
  walletOptions: Opt[];
  walletBalances: Record<string, number>;
  /** Dipanggil setelah daftar diproses jadi pembelian, supaya induk memuat ulang stok/pembelian/saldo. */
  onProcessed: () => void;
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const formatQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
interface AddRow { materialId: string; qty: string; price: string }
const EMPTY_ROW: AddRow = { materialId: '', qty: '', price: '' };
const NO_STORE = 'Belum ditentukan tokonya';
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };

export default function MaterialShoppingPanel({ creds, materials, suppliers, walletOptions, walletBalances, onProcessed }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form tambah item
  const [rows, setRows] = useState<AddRow[]>([{ ...EMPTY_ROW }]);
  const [note, setNote] = useState('');
  const [pickSupplierId, setPickSupplierId] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // Proses
  const [showProcess, setShowProcess] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(todayISO());
  const [walletId, setWalletId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [processNote, setProcessNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = async () => {
    const r = await fetch(`${API}/api/material-shopping`, { headers });
    if (r.ok) setItems((await r.json() as { items: ShoppingItem[] }).items);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = items.filter(i => i.status === 'pending');
  const done = items.filter(i => i.status === 'done');
  const checked = pending.filter(i => i.checked);
  const checkedTotal = checked.reduce((s, i) => s + i.qty * (i.price ?? 0), 0);

  // Dikelompokkan per toko (isi kolom "Beli di mana") supaya mudah belanja satu toko demi satu toko.
  const groupMap = new Map<string, ShoppingItem[]>();
  pending.forEach(i => {
    const key = i.note.trim() || NO_STORE;
    groupMap.set(key, [...(groupMap.get(key) ?? []), i]);
  });
  const groups = [...groupMap.entries()].sort(([a], [b]) => (a === NO_STORE ? 1 : b === NO_STORE ? -1 : a.localeCompare(b)));

  const storeSuggestions = [...new Set([...suppliers.map(s => s.name), ...pending.map(i => i.note.trim()).filter(Boolean)])];
  const materialOptions = materials.map(m => ({ value: m.id, label: m.name, sublabel: `Stok ${formatQty(m.stockQty)} ${m.unit}` }));

  const updateRow = (i: number, p: Partial<AddRow>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...p } : r));
  const validRows = rows.filter(r => r.materialId && parseFloat(r.qty) > 0);

  const openAdd = () => { setRows([{ ...EMPTY_ROW }]); setShowAdd(true); };   // keterangan toko dipertahankan antar pembukaan

  const addItems = async () => {
    if (validRows.length === 0) return;
    setAdding(true);
    try {
      const r = await fetch(`${API}/api/material-shopping`, {
        method: 'POST', headers,
        body: JSON.stringify({
          items: validRows.map(x => ({ materialId: x.materialId, qty: parseFloat(x.qty), price: x.price ? parseFloat(x.price) : null })),
          note,
        }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal menambah item.'); return; }
      setShowAdd(false);
      toast.success(`${validRows.length} item ditambahkan ke daftar belanja.`);
      await load();
    } finally { setAdding(false); }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`${API}/api/material-shopping/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!r.ok) { toast.error('Gagal menyimpan perubahan.'); load(); }
  };
  const setLocal = (id: string, p: Partial<ShoppingItem>) => setItems(prev => prev.map(i => i.id === id ? { ...i, ...p } : i));

  const toggle = (i: ShoppingItem) => { setLocal(i.id, { checked: !i.checked }); patch(i.id, { checked: !i.checked }); };

  const remove = async (i: ShoppingItem) => {
    if (!await confirm({ message: `Hapus "${i.materialName}" dari daftar belanja?`, danger: true })) return;
    setItems(prev => prev.filter(x => x.id !== i.id));
    await fetch(`${API}/api/material-shopping/${i.id}`, { method: 'DELETE', headers });
  };

  const openProcess = () => {
    // Kalau semua item yang dicentang berasal dari satu toko, nama toko/supplier langsung terisi.
    const stores = [...new Set(checked.map(i => i.note.trim()).filter(Boolean))];
    const name = stores.length === 1 ? stores[0] : '';
    const sup = suppliers.find(s => s.name.toLowerCase() === name.toLowerCase());
    setSupplierId(sup?.id ?? ''); setSupplierName(name); setDate(todayISO()); setProcessNote('');
    setShowProcess(true);
  };

  const missingPrice = checked.filter(i => !(i.price && i.price > 0));
  const canProcess = !!supplierName.trim() && !!walletId && !!date && checked.length > 0 && missingPrice.length === 0;

  const submitProcess = async () => {
    if (!canProcess) return;
    setProcessing(true);
    try {
      const r = await fetch(`${API}/api/material-shopping/process`, {
        method: 'POST', headers,
        body: JSON.stringify({ ids: checked.map(i => i.id), supplierId: supplierId || undefined, supplierName: supplierName.trim(), date, walletId, paymentStatus, note: processNote }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal memproses daftar belanja.'); return; }
      toast.success(`${checked.length} item diproses jadi pembelian bahan baku.`);
      setShowProcess(false);
      await load();
      onProcessed();
    } finally { setProcessing(false); }
  };

  if (loading) return <PageLoader />;

  return (
    <>
    <div className="p-4 lg:p-6 animate-fade-up space-y-5 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Susun daftar sebelum belanja, centang yang sudah dibeli, lalu proses jadi pembelian.</p>
        {pending.length > 0 && (
          <button onClick={() => openAdd()} className="btn-primary text-xs flex-shrink-0" style={{ height: 34 }}>
            <Plus size={13} /> <span className="hidden sm:inline">Tambah Item</span>
          </button>
        )}
      </div>

      {/* Daftar per toko */}
      {pending.length === 0 ? (
        <EmptyAddCard label="Tambah ke Daftar Belanja" onClick={() => openAdd()} />
      ) : groups.map(([store, list]) => (
        <div key={store} className="card overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-bold" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
            {store} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>· {list.length} item</span>
          </div>
          {list.map(i => (
            <div key={i.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" style={{ borderTop: '1px solid var(--border-2)', opacity: i.checked ? 1 : 0.95 }}>
              <button onClick={() => toggle(i)} aria-label={i.checked ? 'Batal centang' : 'Centang sudah dibeli'}
                className="flex-shrink-0 w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center transition-colors"
                style={{ background: i.checked ? 'var(--accent)' : 'transparent', borderColor: i.checked ? 'var(--accent)' : 'var(--border)' }}>
                {i.checked && <Check size={13} color="#fff" strokeWidth={3} />}
              </button>
              <div className="flex-1 min-w-[140px]">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)', textDecoration: i.checked ? 'line-through' : 'none' }}>{i.materialName}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Satuan: {i.unit}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" min="0" value={i.qty} onChange={e => setLocal(i.id, { qty: parseFloat(e.target.value) || 0 })}
                  onBlur={() => { if (i.qty > 0) patch(i.id, { qty: i.qty }); else load(); }}
                  className="input text-right" style={{ width: 80 }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{i.unit}</span>
              </div>
              <div style={{ width: 130 }} onBlur={() => patch(i.id, { price: i.price })}>
                <NumberInput value={i.price != null ? String(Math.round(i.price)) : ''} placeholder="Harga/satuan"
                  onChange={raw => setLocal(i.id, { price: raw ? parseFloat(raw) : null })} />
              </div>
              <Tooltip label="Hapus dari daftar">
                <button onClick={() => remove(i)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
              </Tooltip>
            </div>
          ))}
        </div>
      ))}

      {/* Riwayat yang sudah diproses */}
      {done.length > 0 && (
        <div>
          <button onClick={() => setShowDone(v => !v)} className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
            {showDone ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Sudah diproses ({done.length})
          </button>
          {showDone && (
            <div className="card mt-2 overflow-hidden">
              {done.map(i => (
                <div key={i.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs" style={{ borderTop: '1px solid var(--border-2)', color: 'var(--text-muted)' }}>
                  <span>{i.materialName} · {formatQty(i.qty)} {i.unit}{i.note ? ` · ${i.note}` : ''}</span>
                  <span className="tabular">{formatRp(i.qty * (i.price ?? 0))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>

      {/* Bilah proses & modal — di luar wadah beranimasi (transform) supaya `fixed` relatif ke viewport */}
      {checked.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-32px)] max-w-xl rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-xl"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-xs">
            <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{checked.length} item dicentang</p>
            <p className="tabular" style={{ color: 'var(--text-muted)' }}>Total {formatRp(checkedTotal)}</p>
          </div>
          <button onClick={openProcess} className="btn-primary px-4 py-2.5 text-xs">Proses jadi Pembelian</button>
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={() => !adding && setShowAdd(false)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingCart size={17} /></div>
                <div>
                  <p className="modal-title">Tambah ke Daftar Belanja</p>
                  <p className="modal-subtitle">Belum mengubah stok — baru jadi pembelian setelah dicentang &amp; diproses</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowAdd(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={fieldLabel}>Bahan Baku yang Dibeli</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rows.map((row, i) => {
                      const mat = materials.find(m => m.id === row.materialId);
                      return (
                        <div key={i} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-2)' }}>
                          <div className="flex items-center gap-2 mb-2">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchSelect value={row.materialId} onChange={id => updateRow(i, { materialId: id })}
                                options={materialOptions} placeholder="– Bahan baku –" searchPlaceholder="Cari bahan baku…" />
                            </div>
                            <Tooltip label="Hapus baris">
                              <button onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))} disabled={rows.length === 1}
                                className="btn-ghost p-2 disabled:opacity-30 flex-shrink-0" style={{ color: 'var(--danger)' }}>
                                <X size={14} />
                              </button>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label style={fieldLabel}>{`Qty${mat ? ` (${mat.unit})` : ''}`}</label>
                              <input type="number" min="0" value={row.qty} onChange={e => updateRow(i, { qty: e.target.value })} placeholder="0" className="input" />
                            </div>
                            <div>
                              <label style={fieldLabel}>Perkiraan harga/satuan</label>
                              <NumberInput value={row.price} onChange={raw => updateRow(i, { price: raw })} placeholder="0" />
                            </div>
                          </div>
                          {parseFloat(row.qty) > 0 && parseFloat(row.price) > 0 && (
                            <p className="text-xs tabular mt-2" style={{ color: 'var(--text-muted)' }}>Subtotal: {formatRp(parseFloat(row.qty) * parseFloat(row.price))}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setRows(prev => [...prev, { ...EMPTY_ROW }])} className="flex items-center gap-1 text-xs font-bold mt-2.5" style={{ color: 'var(--accent)' }}>
                    <Plus size={12} /> Tambah Baris Bahan Baku
                  </button>
                </div>

                <div>
                  <label style={fieldLabel}>Supplier (opsional)</label>
                  <SearchSelect value={pickSupplierId}
                    onChange={id => { setPickSupplierId(id); const sup = suppliers.find(x => x.id === id); setNote(sup ? sup.name : ''); }}
                    options={[{ value: '', label: '– Toko/warung lain, isi manual di bawah –' }, ...suppliers.map(x => ({ value: x.id, label: x.name }))]}
                    placeholder="– Pilih Supplier –" searchPlaceholder="Cari supplier…" />
                </div>
                <div>
                  <label style={fieldLabel}>Beli di toko mana / keterangan (opsional)</label>
                  <input type="text" list="shopping-store-suggestions" value={note}
                    onChange={e => { setNote(e.target.value); if (suppliers.find(x => x.id === pickSupplierId)?.name !== e.target.value) setPickSupplierId(''); }}
                    maxLength={200} placeholder="cth: Warung Bu Tini, Pasar pagi" className="input" />
                  <datalist id="shopping-store-suggestions">{storeSuggestions.map(s => <option key={s} value={s} />)}</datalist>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Terisi otomatis dari supplier yang dipilih; untuk toko yang belum terdaftar, ketik manual.</p>
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{validRows.length} item</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Perkiraan Total</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(validRows.reduce((t, r) => t + parseFloat(r.qty) * (parseFloat(r.price) || 0), 0))}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowAdd(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={addItems} disabled={adding || validRows.length === 0} className="btn-primary"
                style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {adding ? 'Menyimpan…' : `Simpan${validRows.length > 1 ? ` (${validRows.length} item)` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showProcess && (
        <div className="modal-overlay" onClick={() => !processing && setShowProcess(false)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingCart size={17} /></div>
                <div>
                  <p className="modal-title">Proses jadi Pembelian</p>
                  <p className="modal-subtitle">{checked.length} item · {formatRp(checkedTotal)} — stok &amp; harga rata-rata ter-update otomatis</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowProcess(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: 'var(--surface-2)' }}>
                  {checked.map(i => (
                    <div key={i.id} className="flex justify-between gap-3">
                      <span>{i.materialName} · {formatQty(i.qty)} {i.unit}</span>
                      <span className="tabular" style={{ color: i.price ? 'var(--text-secondary)' : 'var(--danger)' }}>{i.price ? formatRp(i.qty * i.price) : 'harga belum diisi'}</span>
                    </div>
                  ))}
                </div>
                {missingPrice.length > 0 && (
                  <p className="text-xs" style={{ color: 'var(--danger)' }}>Isi harga sebenarnya di daftar dulu untuk: {missingPrice.map(i => i.materialName).join(', ')}.</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Supplier terdaftar</label>
                    <SearchSelect value={supplierId}
                      onChange={id => { setSupplierId(id); const s = suppliers.find(ss => ss.id === id); if (s) setSupplierName(s.name); }}
                      options={[{ value: '', label: '– Toko/warung lain, tidak terdaftar –' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
                      placeholder="– Pilih Supplier –" searchPlaceholder="Cari supplier…" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Nama Toko / Supplier <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)} className="input" placeholder="cth: Warung Bu Tini" />
                  </div>
                </div>
                <div>
                  <label style={fieldLabel}>Tanggal Pembelian</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" style={{ maxWidth: 220 }} />
                </div>
                <div>
                  <label style={fieldLabel}>Dompet Sumber <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchSelect value={walletId} onChange={setWalletId} options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
                  {walletId && <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Saldo saat ini: {formatRp(walletBalances[walletId] ?? 0)}</p>}
                </div>
                <div>
                  <label style={fieldLabel}>Status Pembayaran</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {(['lunas', 'belum_lunas'] as const).map(s => (
                      <button key={s} type="button" onClick={() => setPaymentStatus(s)} className="flex-1 px-3.5 py-2.5 text-xs font-bold transition-all"
                        style={paymentStatus === s ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {s === 'lunas' ? 'Lunas' : 'Belum Lunas'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={processNote} onChange={e => setProcessNote(e.target.value)} className="input" placeholder="Opsional (default: Dari Daftar Belanja)" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowProcess(false)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={submitProcess} disabled={processing || !canProcess} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {processing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {processing ? 'Memproses…' : 'Simpan Pembelian'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
