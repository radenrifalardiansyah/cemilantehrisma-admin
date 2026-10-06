'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, X } from 'lucide-react';
import NumberInput from '@/components/NumberInput';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

interface Voucher {
  code: string; description: string; type: 'percent' | 'nominal'; value: number;
  minPurchase: number; maxDiscount: number; validFrom: string; validUntil: string;
  usageLimit: number; perCustomerLimit: number; usedCount: number; isActive: boolean;
}
interface Form {
  code: string; isNew: boolean; description: string; type: 'percent' | 'nominal'; value: string;
  minPurchase: string; maxDiscount: string; validFrom: string; validUntil: string; usageLimit: string; perCustomerLimit: string; isActive: boolean;
}

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`;
const emptyForm = (): Form => ({
  code: '', isNew: true, description: '', type: 'percent', value: '', minPurchase: '', maxDiscount: '',
  validFrom: '', validUntil: '', usageLimit: '', perCustomerLimit: '', isActive: true,
});

// Kelola voucher diskon yang dipakai di Kasir. Voucher yang sudah pernah dipakai tidak bisa
// dihapus (jejak pesanan merujuk kodenya) — cukup dinonaktifkan.
export default function VouchersPanel({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [today] = useState(() => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));

  const load = async () => {
    const r = await fetch('/api/vouchers', { headers });
    if (r.ok) setVouchers((await r.json() as { vouchers: Voucher[] }).vouchers);
    else setVouchers([]);
  };
  useEffect(() => {
    fetch('/api/vouchers', { headers: { 'x-admin-auth': creds } })
      .then(async r => setVouchers(r.ok ? (await r.json() as { vouchers: Voucher[] }).vouchers : []))
      .catch(() => setVouchers([]));
  }, [creds]);

  const edit = (v: Voucher) => setForm({
    code: v.code, isNew: false, description: v.description, type: v.type, value: String(v.value),
    minPurchase: v.minPurchase ? String(v.minPurchase) : '', maxDiscount: v.maxDiscount ? String(v.maxDiscount) : '',
    validFrom: v.validFrom, validUntil: v.validUntil, usageLimit: v.usageLimit ? String(v.usageLimit) : '', perCustomerLimit: v.perCustomerLimit ? String(v.perCustomerLimit) : '', isActive: v.isActive,
  });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    const body = {
      code: form.code, description: form.description, type: form.type, value: Number(form.value),
      minPurchase: Number(form.minPurchase) || 0, maxDiscount: Number(form.maxDiscount) || 0,
      validFrom: form.validFrom, validUntil: form.validUntil, usageLimit: Number(form.usageLimit) || 0, perCustomerLimit: Number(form.perCustomerLimit) || 0, isActive: form.isActive,
    };
    const r = await fetch(form.isNew ? '/api/vouchers' : `/api/vouchers/${encodeURIComponent(form.code)}`, {
      method: form.isNew ? 'POST' : 'PUT', headers, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({})) as { error?: string };
    if (r.ok) { toast.success('Voucher tersimpan.'); setForm(null); await load(); }
    else toast.error(d.error ?? 'Gagal menyimpan voucher.');
    setSaving(false);
  };

  const remove = async (v: Voucher) => {
    if (!await confirm({ message: `Hapus voucher "${v.code}"?`, danger: true })) return;
    const r = await fetch(`/api/vouchers/${encodeURIComponent(v.code)}`, { method: 'DELETE', headers });
    const d = await r.json().catch(() => ({})) as { error?: string };
    if (r.ok) { toast.success('Voucher dihapus.'); await load(); }
    else toast.error(d.error ?? 'Gagal menghapus voucher.');
  };

  const status = (v: Voucher) => {
    if (!v.isActive) return { text: 'Nonaktif', cls: 'badge' };
    if (v.validUntil && today > v.validUntil) return { text: 'Kedaluwarsa', cls: 'badge badge-red' };
    if (v.validFrom && today < v.validFrom) return { text: 'Belum mulai', cls: 'badge badge-amber' };
    if (v.usageLimit > 0 && v.usedCount >= v.usageLimit) return { text: 'Kuota habis', cls: 'badge badge-red' };
    return { text: 'Aktif', cls: 'badge badge-green' };
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => f ? { ...f, [k]: v } : f);

  if (vouchers === null) return <PageLoader compact />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Voucher dipakai kasir dengan memasukkan kodenya di keranjang (menggantikan diskon manual).
        </p>
        <button onClick={() => setForm(emptyForm())} className="btn-primary text-xs flex items-center gap-1.5"><Plus size={13} /> Voucher Baru</button>
      </div>

      {vouchers.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada voucher.</p>
      ) : (
        <div className="divide-y divide-[var(--border-2)] rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-2)' }}>
          {vouchers.map(v => {
            const s = status(v);
            return (
              <div key={v.code} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>{v.code}</p>
                    <span className={s.cls}>{s.text}</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {v.type === 'percent' ? `${v.value}%` : rp(v.value)}
                    {v.type === 'percent' && v.maxDiscount > 0 ? ` (maks ${rp(v.maxDiscount)})` : ''}
                    {v.minPurchase > 0 ? ` · min. belanja ${rp(v.minPurchase)}` : ''}
                    {v.validFrom || v.validUntil ? ` · ${v.validFrom || '…'} s/d ${v.validUntil || '…'}` : ''}
                    {` · dipakai ${v.usedCount}${v.usageLimit > 0 ? `/${v.usageLimit}` : 'x'}`}
                    {v.perCustomerLimit > 0 ? ` · maks ${v.perCustomerLimit}× per pelanggan` : ''}
                  </p>
                  {v.description && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{v.description}</p>}
                </div>
                <Tooltip label="Edit"><button onClick={() => edit(v)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)' }}><Pencil size={12} /></button></Tooltip>
                <Tooltip label="Hapus"><button onClick={() => remove(v)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><Trash2 size={12} /></button></Tooltip>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <div className="modal-overlay" onClick={() => !saving && setForm(null)}>
          <div className="modal-sheet modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div>
                  <p className="modal-title">{form.isNew ? 'Voucher Baru' : `Edit ${form.code}`}</p>
                </div>
              </div>
              <button onClick={() => setForm(null)} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="field-label">Kode <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input type="text" value={form.code} disabled={!form.isNew} onChange={e => set('code', e.target.value.toUpperCase())} className="input" placeholder="HEMAT10" />
              </div>
              <div>
                <label className="field-label">Keterangan</label>
                <input type="text" value={form.description} onChange={e => set('description', e.target.value)} className="input" placeholder="Mis. Promo Lebaran" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Jenis</label>
                  <div className="flex rounded-xl overflow-hidden border text-xs font-bold" style={{ borderColor: 'var(--border)' }}>
                    {(['percent', 'nominal'] as const).map(t => (
                      <button key={t} type="button" onClick={() => set('type', t)} className="flex-1 px-3 py-2.5"
                        style={form.type === t ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { color: 'var(--text-muted)' }}>
                        {t === 'percent' ? 'Persen %' : 'Nominal Rp'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="field-label">Nilai <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <NumberInput value={form.value} onChange={v => set('value', v)} className="input" placeholder={form.type === 'percent' ? '10' : '5.000'} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Min. Belanja (Rp)</label>
                  <NumberInput value={form.minPurchase} onChange={v => set('minPurchase', v)} className="input" placeholder="0 = bebas" />
                </div>
                {form.type === 'percent' && (
                  <div>
                    <label className="field-label">Maks. Potongan (Rp)</label>
                    <NumberInput value={form.maxDiscount} onChange={v => set('maxDiscount', v)} className="input" placeholder="0 = tanpa batas" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Berlaku Mulai</label>
                  <input type="date" value={form.validFrom} onChange={e => set('validFrom', e.target.value)} className="input" />
                </div>
                <div>
                  <label className="field-label">Berlaku Sampai</label>
                  <input type="date" value={form.validUntil} onChange={e => set('validUntil', e.target.value)} className="input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Kuota Total</label>
                  <NumberInput value={form.usageLimit} onChange={v => set('usageLimit', v)} className="input" placeholder="0 = tanpa batas" />
                </div>
                <div>
                  <label className="field-label">Maks. per Pelanggan</label>
                  <NumberInput value={form.perCustomerLimit} onChange={v => set('perCustomerLimit', v)} className="input" placeholder="0 = tanpa batas" />
                </div>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)', marginTop: -6 }}>
                Batas per pelanggan dikenali dari akun (online) atau nomor HP / pelanggan terpilih (Kasir). Kalau diisi, voucher TIDAK bisa dipakai pada transaksi tanpa nomor HP (mis. &quot;Pelanggan Umum&quot;).
              </p>
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} /> Aktif
              </label>
            </div>
            <div className="modal-footer">
              <button onClick={() => setForm(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
              <button onClick={save} disabled={saving || !form.code.trim() || !form.value} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : null} Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
