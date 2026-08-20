'use client';

import { useState, useEffect } from 'react';
import {
  Wallet as WalletIcon, Plus, Pencil, Trash2, X, Check, Loader2, Power,
} from 'lucide-react';
import IconPicker from '@/components/IconPicker';
import ColorPicker from '@/components/ColorPicker';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { resolveIcon } from '@/lib/icon-registry';
import type { WalletDoc } from '@/lib/useWallets';

const API = '';

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

const WALLET_TYPE_LABEL: Record<string, string> = { cash: 'Tunai', bank: 'Bank', ewallet: 'E-Wallet', other: 'Lainnya' };
const WALLET_TYPES = ['cash', 'bank', 'ewallet', 'other'] as const;

interface IncomeRow { amount: number; walletId?: string | null }
interface ExpenseRow { amount: number; walletId?: string | null }
interface CapitalRow { type: 'modal' | 'prive'; amount: number; walletId?: string | null }
interface OrderRow {
  total?: number; source?: 'kasir' | 'portal'; status?: string;
  paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
}
interface RecapRow { totalRevenue?: number; paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null }

type WalletForm = { name: string; type: WalletDoc['type']; icon: string; color: string; initialBalance: string };
const emptyForm = (): WalletForm => ({ name: '', type: 'cash', icon: 'Wallet', color: '#D4691E', initialBalance: '' });

export default function WalletsTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds };

  const [wallets, setWallets] = useState<WalletDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [unassigned, setUnassigned] = useState(0);

  const [editing, setEditing] = useState<({ id: string } & WalletForm) | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const qs = 'from=2000-01-01';
    const [wRes, iRes, eRes, cRes, oRes, rRes] = await Promise.all([
      fetch(`${API}/api/wallets`, { headers }),
      fetch(`${API}/api/income?${qs}`, { headers }),
      fetch(`${API}/api/expenses?${qs}`, { headers }),
      fetch(`${API}/api/capital?${qs}`, { headers }),
      fetch(`${API}/api/orders?${qs}`, { headers }),
      fetch(`${API}/api/consignment/recap?${qs}`, { headers }),
    ]);
    const walletList: WalletDoc[] = wRes.ok ? (await wRes.json() as { wallets: WalletDoc[] }).wallets : [];
    const income: IncomeRow[] = iRes.ok ? (await iRes.json() as { income: IncomeRow[] }).income : [];
    const expenses: ExpenseRow[] = eRes.ok ? (await eRes.json() as { expenses: ExpenseRow[] }).expenses : [];
    const capital: CapitalRow[] = cRes.ok ? (await cRes.json() as { entries: CapitalRow[] }).entries : [];
    const orders: OrderRow[] = oRes.ok ? (await oRes.json() as { orders: OrderRow[] }).orders : [];
    const recaps: RecapRow[] = rRes.ok ? (await rRes.json() as { recaps: RecapRow[] }).recaps : [];

    // Sama persis dengan definisi "uang masuk terhitung" di IncomeTab/FinanceReportTab.
    const countedOrders = orders.filter(o =>
      (o.source !== 'portal' || o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan');
    const countedRecaps = recaps.filter(r => r.paymentStatus !== 'belum_lunas');

    const balanceOf = (walletId: string | null) => {
      const match = (v: { walletId?: string | null }) => (v.walletId ?? null) === walletId;
      const wallet = walletId ? walletList.find(w => w.id === walletId) : undefined;
      return (wallet?.initialBalance ?? 0)
        + income.filter(match).reduce((s, i) => s + i.amount, 0)
        + countedOrders.filter(match).reduce((s, o) => s + (o.total ?? 0), 0)
        + countedRecaps.filter(match).reduce((s, r) => s + (r.totalRevenue ?? 0), 0)
        - expenses.filter(match).reduce((s, e) => s + e.amount, 0)
        + capital.filter(c => match(c) && c.type === 'modal').reduce((s, c) => s + c.amount, 0)
        - capital.filter(c => match(c) && c.type === 'prive').reduce((s, c) => s + c.amount, 0);
    };

    const nextBalances: Record<string, number> = {};
    walletList.forEach(w => { nextBalances[w.id] = balanceOf(w.id); });

    setWallets(walletList);
    setBalances(nextBalances);
    setUnassigned(balanceOf(null));
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditing({ id: '', ...emptyForm() }); setIsNew(true); setError(''); };
  const openEdit = (w: WalletDoc) => {
    setEditing({ id: w.id, name: w.name, type: w.type, icon: w.icon, color: w.color, initialBalance: String(w.initialBalance) });
    setIsNew(false); setError('');
  };
  const closeEdit = () => { setEditing(null); setIsNew(false); setError(''); };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Nama dompet wajib diisi.'); return; }
    setSaving(true); setError('');
    const payload = {
      name: editing.name.trim(), type: editing.type, icon: editing.icon, color: editing.color,
      initialBalance: parseFloat(editing.initialBalance) || 0,
    };
    const r = isNew
      ? await fetch(`${API}/api/wallets`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`${API}/api/wallets/${editing.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (r.ok) {
      await load();
      closeEdit();
      toast.success(isNew ? 'Dompet berhasil ditambahkan.' : 'Dompet berhasil diperbarui.');
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      setError(d.error ?? 'Gagal menyimpan dompet.');
      toast.error(d.error ?? 'Gagal menyimpan dompet.');
    }
    setSaving(false);
  };

  const toggleActive = async (w: WalletDoc) => {
    setTogglingId(w.id);
    const r = await fetch(`${API}/api/wallets/${w.id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !w.isActive }),
    });
    if (r.ok) {
      await load();
      toast.success(w.isActive ? `Dompet "${w.name}" dinonaktifkan.` : `Dompet "${w.name}" diaktifkan kembali.`);
    } else {
      toast.error('Gagal mengubah status dompet.');
    }
    setTogglingId(null);
  };

  const del = async (w: WalletDoc) => {
    if (!await confirm({ message: `Hapus dompet "${w.name}"? Tindakan ini tidak bisa dibatalkan.`, danger: true })) return;
    setDeletingId(w.id);
    const r = await fetch(`${API}/api/wallets/${w.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      await load();
      toast.success(`Dompet "${w.name}" berhasil dihapus.`);
    } else {
      const d = await r.json().catch(() => ({ error: undefined })) as { error?: string };
      toast.error(d.error ?? 'Gagal menghapus dompet.');
    }
    setDeletingId(null);
  };

  const totalAktif = wallets.filter(w => w.isActive).reduce((s, w) => s + (balances[w.id] ?? 0), 0);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">

      {/* Ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
            <WalletIcon size={16} />
          </div>
          <div>
            <p className="text-lg font-extrabold tabular leading-none" style={{ color: 'var(--success)' }}>{formatRp(totalAktif)}</p>
            <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Total Saldo Dompet Aktif</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
            <WalletIcon size={16} />
          </div>
          <div>
            <p className="text-lg font-extrabold tabular leading-none" style={{ color: 'var(--text-secondary)' }}>{formatRp(unassigned)}</p>
            <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Belum Ditentukan (transaksi lama)</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end">
        <button onClick={openNew} className="btn-primary text-xs" style={{ height: 34 }}>
          <Plus size={13} /> Tambah Dompet
        </button>
      </div>

      {wallets.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">👛</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Belum ada dompet</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Klik &quot;Tambah Dompet&quot; untuk membuat dompet pertama (mis. Kas Tunai, BCA, atau e-wallet).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {wallets.map(w => {
            const Icon = resolveIcon(w.icon);
            const balance = balances[w.id] ?? 0;
            const isDeleting = deletingId === w.id;
            const isToggling = togglingId === w.id;
            return (
              <div key={w.id} className="card overflow-hidden" style={{ opacity: w.isActive ? 1 : 0.55 }}>
                <div className="pt-5 pb-3 px-4 flex flex-col items-center text-center gap-1">
                  <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center mb-1" style={{ background: `${w.color}22`, color: w.color }}>
                    <Icon size={22} />
                  </div>
                  <p className="text-sm font-bold truncate max-w-full" style={{ color: 'var(--text-primary)' }}>{w.name}</p>
                  <div className="flex items-center gap-1">
                    <span className="badge badge-gray text-[10px]">{WALLET_TYPE_LABEL[w.type]}</span>
                    {!w.isActive && <span className="badge badge-gray text-[10px]">Nonaktif</span>}
                  </div>
                  <p className="text-base font-extrabold tabular mt-1" style={{ color: balance >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>
                    {formatRp(balance)}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-1 px-4 py-2" style={{ borderTop: '1px solid var(--border-2)' }}>
                  <Tooltip label="Edit">
                    <button onClick={() => openEdit(w)} className="btn-ghost p-1.5" style={{ color: 'var(--accent)' }}>
                      <Pencil size={12} />
                    </button>
                  </Tooltip>
                  <Tooltip label={w.isActive ? 'Nonaktifkan' : 'Aktifkan'}>
                    <button onClick={() => toggleActive(w)} disabled={isToggling} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--text-muted)' }}>
                      {isToggling ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                    </button>
                  </Tooltip>
                  <Tooltip label="Hapus">
                    <button onClick={() => del(w)} disabled={isDeleting} className="btn-ghost p-1.5 disabled:opacity-30" style={{ color: 'var(--danger)' }}>
                      {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit modal */}
      {editing && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><WalletIcon size={17} /></div>
                <div>
                  <p className="modal-title">{isNew ? 'Tambah Dompet' : 'Edit Dompet'}</p>
                  <p className="modal-subtitle">{isNew ? 'Buat dompet/sumber dana baru' : `Edit: ${editing.name}`}</p>
                </div>
              </div>
              <Tooltip label="Tutup"><button onClick={closeEdit} className="modal-close"><X size={14} /></button></Tooltip>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="flex items-center gap-3">
                  <IconPicker value={editing.icon} onChange={icon => setEditing({ ...editing, icon })} />
                  <ColorPicker value={editing.color} onChange={color => setEditing({ ...editing, color })} />
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Nama Dompet <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                      className="input" placeholder="cth: Kas Tunai, BCA, OVO" autoFocus />
                  </div>
                </div>

                <div>
                  <label className="field-label">Tipe</label>
                  <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {WALLET_TYPES.map(t => (
                      <button key={t} type="button" onClick={() => setEditing({ ...editing, type: t })}
                        className="flex-1 px-2 py-2.5 text-xs font-bold transition-all"
                        style={editing.type === t ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {WALLET_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="field-label">Saldo Awal (Rp)</label>
                  <NumberInput value={editing.initialBalance} onChange={raw => setEditing({ ...editing, initialBalance: raw })} placeholder="0" />
                </div>

                {error && (
                  <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeEdit} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                Batal
              </button>
              <button onClick={save} disabled={saving} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Menyimpan…' : 'Simpan Dompet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
