'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Loader2, ShoppingCart, Check, Trash2, Pencil, Search, FolderOpen } from 'lucide-react';
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
  qty: number; price: number | null; note: string;
  shoppingDate: string; supplierId?: string; supplierName: string;
  checked: boolean; status: 'pending' | 'done'; purchaseId?: string; doneAt?: string;
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

// Satu daftar belanja = kumpulan item dengan tanggal + supplier yang sama (otomatis tergabung).
interface ShoppingGroup {
  key: string; date: string; supplierId?: string; supplierName: string;
  items: ShoppingItem[]; pending: ShoppingItem[]; checked: ShoppingItem[];
  total: number; notes: string[]; status: 'menunggu' | 'belanja' | 'sebagian' | 'selesai';
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const formatQty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDateLong = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const NO_SUPPLIER = 'Tanpa supplier';
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5, display: 'block' };
const thStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 9.5, borderBottom: '1px solid var(--border-2)' };
const thCls = 'px-3 py-2.5 font-bold uppercase tracking-wide whitespace-nowrap';

interface AddRow { materialId: string; qty: string; price: string }
const EMPTY_ROW: AddRow = { materialId: '', qty: '', price: '' };

const supplierKeyOf = (i: ShoppingItem) => i.supplierId ? `id:${i.supplierId}` : `n:${i.supplierName.trim().toLowerCase()}`;

const STATUS_BADGE: Record<ShoppingGroup['status'], { label: string; cls: string }> = {
  menunggu: { label: 'Menunggu', cls: 'badge-gray' },
  belanja:  { label: 'Sedang belanja', cls: 'badge-blue' },
  sebagian: { label: 'Sebagian', cls: 'badge-amber' },
  selesai:  { label: 'Selesai', cls: 'badge-green' },
};

function buildGroups(items: ShoppingItem[]): ShoppingGroup[] {
  const map = new Map<string, ShoppingItem[]>();
  items.forEach(i => {
    const key = `${i.shoppingDate}|${supplierKeyOf(i)}`;
    map.set(key, [...(map.get(key) ?? []), i]);
  });
  return [...map.entries()].map(([key, list]) => {
    const pending = list.filter(i => i.status === 'pending');
    const done = list.filter(i => i.status === 'done');
    const checked = pending.filter(i => i.checked);
    const status: ShoppingGroup['status'] = pending.length === 0 ? 'selesai' : done.length > 0 ? 'sebagian' : checked.length > 0 ? 'belanja' : 'menunggu';
    return {
      key, date: list[0].shoppingDate, supplierId: list[0].supplierId, supplierName: list[0].supplierName,
      items: list, pending, checked,
      total: list.reduce((s, i) => s + i.qty * (i.price ?? 0), 0),
      notes: [...new Set(list.map(i => i.note.trim()).filter(Boolean))],
      status,
    };
  });
}

export default function MaterialShoppingPanel({ creds, materials, suppliers, walletOptions, walletBalances, onProcessed }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Form daftar (buat baru / tambah item ke daftar / ubah header)
  const [form, setForm] = useState<{ mode: 'create' | 'add' | 'edit'; group?: ShoppingGroup } | null>(null);
  const [fDate, setFDate] = useState(todayISO());
  const [fSupplierId, setFSupplierId] = useState('');
  const [fSupplierName, setFSupplierName] = useState('');
  const [fNote, setFNote] = useState('');
  const [rows, setRows] = useState<AddRow[]>([{ ...EMPTY_ROW }]);
  const [saving, setSaving] = useState(false);

  // Detail daftar (centang) & proses
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [showProcess, setShowProcess] = useState(false);
  const [pDate, setPDate] = useState(todayISO());
  const [walletId, setWalletId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'lunas' | 'belum_lunas'>('lunas');
  const [pNote, setPNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const load = async () => {
    const r = await fetch(`${API}/api/material-shopping`, { headers });
    if (r.ok) setItems((await r.json() as { items: ShoppingItem[] }).items);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase();
  const allGroups = buildGroups(items);
  const groups = q
    ? allGroups.filter(g => g.supplierName.toLowerCase().includes(q) || g.notes.some(n => n.toLowerCase().includes(q)) || g.items.some(i => i.materialName.toLowerCase().includes(q)))
    : allGroups;

  // Per tanggal (terbaru dulu), di dalamnya dipisah per supplier.
  const byDate = new Map<string, ShoppingGroup[]>();
  groups.forEach(g => byDate.set(g.date, [...(byDate.get(g.date) ?? []), g]));
  const dateBlocks = [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, gs]) => ({
      date,
      groups: gs.slice().sort((a, b) => (a.supplierName || '￿').localeCompare(b.supplierName || '￿')),
      total: gs.reduce((s, g) => s + g.total, 0),
      itemCount: gs.reduce((s, g) => s + g.items.length, 0),
    }));

  const detail = detailKey ? allGroups.find(g => g.key === detailKey) ?? null : null;
  const materialOptions = materials.map(m => ({ value: m.id, label: m.name, sublabel: `Stok ${formatQty(m.stockQty)} ${m.unit}` }));
  const supplierOptions = [{ value: '', label: '– Toko/warung lain, isi nama di bawah –' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))];
  const supplierLabel = (g: { supplierName: string }) => g.supplierName.trim() || NO_SUPPLIER;

  // ── Form ──
  const openForm = (mode: 'create' | 'add' | 'edit', group?: ShoppingGroup) => {
    setForm({ mode, group });
    setFDate(group?.date ?? todayISO());
    setFSupplierId(group?.supplierId ?? '');
    setFSupplierName(group?.supplierName ?? '');
    setFNote(group?.notes.join(' · ') ?? '');
    setRows([{ ...EMPTY_ROW }]);
  };
  const updateRow = (i: number, p: Partial<AddRow>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...p } : r));
  const validRows = rows.filter(r => r.materialId && parseFloat(r.qty) > 0);
  const formTotal = validRows.reduce((t, r) => t + parseFloat(r.qty) * (parseFloat(r.price) || 0), 0);
  const canSave = !!fDate && (form?.mode === 'edit' || validRows.length > 0);

  const saveForm = async () => {
    if (!form || !canSave) return;
    setSaving(true);
    try {
      // Nama toko yang sama dengan supplier terdaftar otomatis dianggap supplier itu (supaya tergabung).
      const typed = fSupplierName.trim();
      const matched = fSupplierId ? undefined : suppliers.find(s => s.name.toLowerCase() === typed.toLowerCase());
      const supplierId = fSupplierId || matched?.id || '';
      const supplierName = suppliers.find(s => s.id === supplierId)?.name ?? typed;
      const base = { date: fDate, supplierId, supplierName, note: fNote };
      const r = form.mode === 'edit'
        ? await fetch(`${API}/api/material-shopping/group`, { method: 'PUT', headers, body: JSON.stringify({ ...base, ids: form.group!.pending.map(i => i.id) }) })
        : await fetch(`${API}/api/material-shopping`, {
            method: 'POST', headers,
            body: JSON.stringify({ ...base, items: validRows.map(x => ({ materialId: x.materialId, qty: parseFloat(x.qty), price: x.price ? parseFloat(x.price) : null })) }),
          });
      const d = await r.json() as { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal menyimpan daftar belanja.'); return; }
      toast.success(form.mode === 'edit' ? 'Daftar belanja diperbarui.' : `${validRows.length} item ditambahkan ke daftar belanja.`);
      setForm(null);
      await load();
    } finally { setSaving(false); }
  };

  // ── Item di dalam daftar ──
  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`${API}/api/material-shopping/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!r.ok) { toast.error('Gagal menyimpan perubahan.'); load(); }
  };
  const setLocal = (id: string, p: Partial<ShoppingItem>) => setItems(prev => prev.map(i => i.id === id ? { ...i, ...p } : i));
  const toggle = (i: ShoppingItem) => { setLocal(i.id, { checked: !i.checked }); patch(i.id, { checked: !i.checked }); };
  const removeItem = async (i: ShoppingItem) => {
    if (!await confirm({ message: `Hapus "${i.materialName}" dari daftar belanja?`, danger: true })) return;
    setItems(prev => prev.filter(x => x.id !== i.id));
    await fetch(`${API}/api/material-shopping/${i.id}`, { method: 'DELETE', headers });
  };
  const removeGroup = async (g: ShoppingGroup) => {
    if (!await confirm({ message: `Hapus daftar belanja ${supplierLabel(g)} (${formatDateLong(g.date)})? ${g.pending.length} item yang belum dibeli akan dihapus.`, danger: true })) return;
    const r = await fetch(`${API}/api/material-shopping/group`, { method: 'DELETE', headers, body: JSON.stringify({ ids: g.pending.map(i => i.id) }) });
    if (r.ok) { toast.success('Daftar belanja dihapus.'); if (detailKey === g.key) setDetailKey(null); await load(); }
    else toast.error('Gagal menghapus daftar belanja.');
  };

  // ── Proses ──
  const openProcess = (g: ShoppingGroup) => { setPDate(todayISO()); setPNote(g.notes.join(' · ')); setShowProcess(true); };
  const checkedTotal = detail ? detail.checked.reduce((s, i) => s + i.qty * (i.price ?? 0), 0) : 0;
  const missingPrice = detail ? detail.checked.filter(i => !(i.price && i.price > 0)) : [];
  const canProcess = !!detail && detail.checked.length > 0 && missingPrice.length === 0 && !!walletId && !!pDate && !!detail.supplierName.trim();

  const submitProcess = async () => {
    if (!detail || !canProcess) return;
    setProcessing(true);
    try {
      const r = await fetch(`${API}/api/material-shopping/process`, {
        method: 'POST', headers,
        body: JSON.stringify({ ids: detail.checked.map(i => i.id), supplierId: detail.supplierId, supplierName: detail.supplierName.trim(), date: pDate, walletId, paymentStatus, note: pNote }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal memproses daftar belanja.'); return; }
      toast.success(`${detail.checked.length} item diproses jadi pembelian bahan baku.`);
      setShowProcess(false);
      await load();
      onProcessed();
    } finally { setProcessing(false); }
  };

  if (loading) return <PageLoader />;

  return (
    <>
      <div className="p-4 lg:p-6 animate-fade-up space-y-4">
        <div className="flex flex-row items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} className="input text-sm w-full" style={{ paddingLeft: 38, height: 34 }}
              placeholder="Cari supplier atau bahan baku…" />
          </div>
          <button onClick={() => openForm('create')} className="btn-primary text-xs flex-shrink-0" style={{ height: 34 }}>
            <Plus size={13} /> <span className="hidden sm:inline">Buat Daftar Belanja</span>
          </button>
        </div>

        {allGroups.length === 0 ? (
          <EmptyAddCard label="Buat Daftar Belanja" onClick={() => openForm('create')}
            hint="Susun daftar bahan baku yang mau dibeli, lalu centang saat sudah dibeli" />
        ) : dateBlocks.length === 0 ? (
          <p className="text-sm text-center py-10" style={{ color: 'var(--text-muted)' }}>Tidak ada daftar belanja yang cocok.</p>
        ) : dateBlocks.map(block => (
          <div key={block.date} className="card overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
            <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ background: 'var(--surface-2)' }}>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatDateLong(block.date)}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{block.groups.length} supplier · {block.itemCount} item</p>
              </div>
              <p className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>Total {formatRp(block.total)}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className={`${thCls} text-left`} style={thStyle}>Supplier</th>
                    <th className={`${thCls} text-right`} style={thStyle}>Item</th>
                    <th className={`${thCls} text-right`} style={thStyle}>Perkiraan Total</th>
                    <th className={`${thCls} text-left`} style={thStyle}>Status</th>
                    <th className={`${thCls} text-right`} style={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {block.groups.map(g => {
                    const doneCount = g.items.length - g.pending.length;
                    return (
                      <tr key={g.key} onClick={() => setDetailKey(g.key)} className="cursor-pointer" style={{ borderBottom: '1px solid var(--border-2)' }}>
                        <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>
                          <p className="font-semibold">{supplierLabel(g)}</p>
                          {g.notes.length > 0 && <p className="text-[10.5px] truncate max-w-[260px]" style={{ color: 'var(--text-muted)' }}>{g.notes.join(' · ')}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{doneCount}/{g.items.length} dibeli</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{formatRp(g.total)}</td>
                        <td className="px-3 py-2.5"><span className={`badge ${STATUS_BADGE[g.status].cls}`}>{STATUS_BADGE[g.status].label}</span></td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <Tooltip label="Buka & centang">
                              <button onClick={() => setDetailKey(g.key)} className="btn-ghost p-2"><FolderOpen size={14} /></button>
                            </Tooltip>
                            {g.pending.length > 0 && (
                              <>
                                <Tooltip label="Ubah tanggal / supplier / catatan">
                                  <button onClick={() => openForm('edit', g)} className="btn-ghost p-2"><Pencil size={14} /></button>
                                </Tooltip>
                                <Tooltip label="Hapus daftar">
                                  <button onClick={() => removeGroup(g)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                                </Tooltip>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <td className="px-3 py-2.5 font-bold" style={{ color: 'var(--text-primary)' }}>Total semua supplier</td>
                    <td className="px-3 py-2.5 text-right font-bold tabular" style={{ color: 'var(--text-secondary)' }}>{block.itemCount} item</td>
                    <td className="px-3 py-2.5 text-right font-extrabold tabular whitespace-nowrap" style={{ color: 'var(--accent)' }}>{formatRp(block.total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Modal & bilah di luar wadah beranimasi (transform) supaya `fixed` relatif ke viewport */}

      {/* Detail daftar: centang item */}
      {detail && (
        <div className="modal-overlay" onClick={() => !processing && setDetailKey(null)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingCart size={17} /></div>
                <div>
                  <p className="modal-title">{supplierLabel(detail)}</p>
                  <p className="modal-subtitle">{formatDateLong(detail.date)}{detail.notes.length > 0 ? ` · ${detail.notes.join(' · ')}` : ''}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setDetailKey(null)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Centang item yang sudah dibeli. Ubah qty &amp; harga sesuai nota, lalu tekan Proses.</p>
                {detail.items.map(i => i.status === 'done' ? (
                  <div key={i.id} className="px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 text-xs" style={{ border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    <span className="flex items-center gap-2"><Check size={13} style={{ color: 'var(--success)' }} /> {i.materialName} · {formatQty(i.qty)} {i.unit}</span>
                    <span className="tabular">{formatRp(i.qty * (i.price ?? 0))}</span>
                  </div>
                ) : (
                  <div key={i.id} className="p-3 rounded-xl flex flex-wrap items-center gap-x-3 gap-y-2" style={{ border: '1px solid var(--border-2)' }}>
                    <button onClick={() => toggle(i)} aria-label={i.checked ? 'Batal centang' : 'Centang sudah dibeli'}
                      className="flex-shrink-0 w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center transition-colors"
                      style={{ background: i.checked ? 'var(--accent)' : 'transparent', borderColor: i.checked ? 'var(--accent)' : 'var(--border)' }}>
                      {i.checked && <Check size={13} color="#fff" strokeWidth={3} />}
                    </button>
                    <div className="flex-1 min-w-[130px]">
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
                      <button onClick={() => removeItem(i)} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                    </Tooltip>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Daftar</span>
                  <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(detail.total)}</span>
                </div>
                {detail.checked.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{detail.checked.length} item dicentang</span>
                    <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(checkedTotal)}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => openForm('add', detail)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                <Plus size={14} /> Tambah Item
              </button>
              <button onClick={() => openProcess(detail)} disabled={detail.checked.length === 0} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                <Check size={14} /> Proses yang Dicentang{detail.checked.length > 0 ? ` (${detail.checked.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form daftar belanja */}
      {form && (
        <div className="modal-overlay" onClick={() => !saving && setForm(null)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingCart size={17} /></div>
                <div>
                  <p className="modal-title">{form.mode === 'edit' ? 'Ubah Daftar Belanja' : form.mode === 'add' ? 'Tambah Item Daftar Belanja' : 'Buat Daftar Belanja'}</p>
                  <p className="modal-subtitle">Belum mengubah stok — baru jadi pembelian setelah dicentang &amp; diproses</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setForm(null)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label style={fieldLabel}>Tanggal <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Supplier</label>
                    <SearchSelect value={fSupplierId}
                      onChange={id => { setFSupplierId(id); const s = suppliers.find(x => x.id === id); if (s) setFSupplierName(s.name); }}
                      options={supplierOptions} placeholder="– Pilih Supplier –" searchPlaceholder="Cari supplier…" />
                  </div>
                </div>
                <div>
                  <label style={fieldLabel}>Nama Toko / Supplier</label>
                  <input type="text" value={fSupplierName} maxLength={120}
                    onChange={e => { setFSupplierName(e.target.value); if (suppliers.find(x => x.id === fSupplierId)?.name !== e.target.value) setFSupplierId(''); }}
                    placeholder="Terisi dari supplier yang dipilih; ketik manual untuk toko/warung lain" className="input" />
                </div>

                {form.mode !== 'edit' && (
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
                )}

                <div>
                  <label style={fieldLabel}>Catatan</label>
                  <input type="text" value={fNote} onChange={e => setFNote(e.target.value)} maxLength={200} placeholder="Catatan tambahan (opsional)" className="input" />
                </div>

                {form.mode !== 'edit' && (
                  <>
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Item</span>
                      <span className="text-lg font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{validRows.length} item</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
                      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Perkiraan Total</span>
                      <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(formTotal)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setForm(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={saveForm} disabled={saving || !canSave} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : form.mode === 'edit' ? 'Simpan Perubahan' : validRows.length > 1 ? `Simpan (${validRows.length} item)` : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Proses jadi pembelian */}
      {showProcess && detail && (
        <div className="modal-overlay" onClick={() => !processing && setShowProcess(false)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><ShoppingCart size={17} /></div>
                <div>
                  <p className="modal-title">Proses jadi Pembelian</p>
                  <p className="modal-subtitle">{supplierLabel(detail)} · {detail.checked.length} item · {formatRp(checkedTotal)} — stok &amp; harga rata-rata ter-update otomatis</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={() => setShowProcess(false)} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: 'var(--surface-2)' }}>
                  {detail.checked.map(i => (
                    <div key={i.id} className="flex justify-between gap-3">
                      <span>{i.materialName} · {formatQty(i.qty)} {i.unit}</span>
                      <span className="tabular" style={{ color: i.price ? 'var(--text-secondary)' : 'var(--danger)' }}>{i.price ? formatRp(i.qty * i.price) : 'harga belum diisi'}</span>
                    </div>
                  ))}
                </div>
                {missingPrice.length > 0 && (
                  <p className="text-xs" style={{ color: 'var(--danger)' }}>Isi harga sebenarnya di daftar dulu untuk: {missingPrice.map(i => i.materialName).join(', ')}.</p>
                )}
                {!detail.supplierName.trim() && (
                  <p className="text-xs" style={{ color: 'var(--danger)' }}>Daftar ini belum punya nama toko/supplier. Tutup, lalu ubah daftar (ikon pensil) dan isi dulu.</p>
                )}
                <div>
                  <label style={fieldLabel}>Tanggal Pembelian</label>
                  <input type="date" value={pDate} onChange={e => setPDate(e.target.value)} className="input" style={{ maxWidth: 220 }} />
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
                  <input type="text" value={pNote} onChange={e => setPNote(e.target.value)} className="input" placeholder="Opsional (default: Dari Daftar Belanja)" />
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
