'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Check, Loader2, X } from 'lucide-react';
import Modal from '@/components/Modal';
import Tooltip from '@/components/Tooltip';
import Field from '@/components/Field';
import NumberInput from '@/components/NumberInput';
import SearchSelect from '@/components/SearchSelect';
import FilterSelect from '@/components/FilterSelect';
import { DateInput } from '@/components/DateTimeInput';
import { useToast } from '@/components/Toast';
import { activeWalletOptions, type WalletDoc } from '@/lib/useWallets';
import { formatRp } from '@/lib/format';
import { closingPeriodLabel } from '@/lib/closing-settlement-core';

export interface SettlementTarget { id: string; periodFrom: string | null; periodTo: string; totalCogs: number; settlementRemaining: number }

interface TransferLite {
  id: string; fromWalletId: string; toWalletId: string; amount: number; date: string; note?: string;
  closingLinks?: { closingId: string; amount: number }[];
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const FETCH_TIMEOUT_MS = 30_000;

// "Catat transfer" dari kartu Closing: (1) catat transfer antar dompet baru + tautan ke closing (satu transaksi di server),
// atau (2) tautkan transfer yang sudah ada dan masih punya sisa belum teralokasi.
export default function ClosingSettlementDialog({ creds, closing, onClose, onDone }: {
  creds: string; closing: SettlementTarget; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const toast = useToast();
  const remaining = Math.max(0, Math.floor(closing.settlementRemaining + 0.005));
  const [tab, setTab] = useState<'new' | 'existing'>('new');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [wallets, setWallets] = useState<WalletDoc[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<TransferLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState(String(remaining));
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const [pickedId, setPickedId] = useState('');
  const [linkAmount, setLinkAmount] = useState('');

  // Muat dompet, saldo, dan transfer sekali saat dialog dibuka (butuh akses baca Dompet).
  useEffect(() => {
    const ctrl = new AbortController();
    const headers = { 'x-admin-auth': creds };
    (async () => {
      try {
        const [w, b, t] = await Promise.all([
          fetch('/api/wallets', { headers, signal: ctrl.signal }),
          fetch('/api/wallets/balances', { headers, signal: ctrl.signal }),
          fetch('/api/wallet-transfers', { headers, signal: ctrl.signal }),
        ]);
        if (!w.ok || !b.ok || !t.ok) { setLoadError('Tidak bisa memuat data Dompet (butuh akses lihat Dompet).'); return; }
        setWallets((await w.json() as { wallets: WalletDoc[] }).wallets);
        setBalances((await b.json() as { balances: Record<string, number> }).balances);
        setTransfers((await t.json() as { transfers: TransferLite[] }).transfers);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.error('Gagal memuat data dompet untuk tautan closing', err);
        setLoadError('Gagal memuat data Dompet.');
      } finally { if (!ctrl.signal.aborted) setLoading(false); }
    })();
    return () => ctrl.abort();
  }, [creds]);

  const walletName = (id: string) => wallets.find(w => w.id === id)?.name ?? id;
  const walletOptions = useMemo(() => activeWalletOptions(wallets, balances), [wallets, balances]);

  // Transfer yang masih punya sisa belum teralokasi (hindari saldo berkurang dua kali) dan belum tertaut ke closing ini.
  const candidates = useMemo(() => transfers
    .map(t => {
      const linked = (t.closingLinks ?? []).reduce((n, l) => n + l.amount, 0);
      return { t, free: Math.round((t.amount - linked) * 100) / 100, here: (t.closingLinks ?? []).some(l => l.closingId === closing.id) };
    })
    .filter(c => c.free > 0 && !c.here)
    .sort((a, b) => b.t.date.localeCompare(a.t.date)), [transfers, closing.id]);
  const picked = candidates.find(c => c.t.id === pickedId);

  const pick = (id: string) => {
    setPickedId(id);
    const c = candidates.find(x => x.t.id === id);
    setLinkAmount(c ? String(Math.max(0, Math.floor(Math.min(remaining, c.free)))) : '');
    setError('');
  };

  const amountNum = parseFloat(amount) || 0;
  const linkNum = parseFloat(linkAmount) || 0;
  const fromBalance = balances[fromId] ?? 0;
  const newProblem = !fromId || !toId ? 'Dompet asal dan tujuan wajib dipilih.'
    : fromId === toId ? 'Dompet asal dan tujuan tidak boleh sama.'
    : amountNum <= 0 ? 'Jumlah transfer harus lebih dari 0.'
    : amountNum > fromBalance ? `Saldo "${walletName(fromId)}" tidak cukup (saldo saat ini ${formatRp(fromBalance)}).`
    : !date ? 'Tanggal wajib diisi.' : '';
  const existingProblem = !picked ? 'Pilih transfer terlebih dahulu.'
    : linkNum <= 0 ? 'Nominal tautan harus lebih dari 0.'
    : linkNum > picked.free + 0.005 ? `Nominal melebihi sisa transfer yang belum ditautkan (${formatRp(picked.free)}).`
    : linkNum > remaining + 0.005 ? `Nominal melebihi sisa HPP closing (${formatRp(remaining)}).` : '';
  const problem = tab === 'new' ? newProblem : existingProblem;

  const submit = async () => {
    if (saving || problem) { if (problem) setError(problem); return; }
    setSaving(true); setError('');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const body = tab === 'new'
        ? { mode: 'new', fromWalletId: fromId, toWalletId: toId, amount: amountNum, date, note, linkAmount: Math.min(amountNum, remaining) }
        : { mode: 'link', walletTransferId: pickedId, amount: linkNum };
      const res = await fetch(`/api/closings/${closing.id}/settlements`, {
        method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Gagal mencatat transfer.'); toast.error(data.error ?? 'Gagal mencatat transfer.'); return; }
      toast.success(tab === 'new' ? 'Transfer dicatat dan ditautkan ke closing.' : 'Transfer ditautkan ke closing.');
      await onDone();
      onClose();
    } catch (err) {
      console.error('Gagal mencatat transfer closing', err);
      setError('Gagal mencatat transfer.');
      toast.error('Gagal mencatat transfer.');
    } finally { clearTimeout(timer); setSaving(false); }
  };

  return (
    <Modal onClose={() => !saving && onClose()} className="modal-sm">
      <div className="modal-accent" />
      <span className="modal-handle" />
      <div className="modal-header">
        <div className="modal-header-left">
          <div className="modal-icon"><ArrowRightLeft size={17} /></div>
          <div>
            <p className="modal-title">Catat Transfer Closing</p>
            <p className="modal-subtitle">{closingPeriodLabel(closing.periodFrom, closing.periodTo)} · HPP {formatRp(closing.totalCogs)} · sisa {formatRp(remaining)}</p>
          </div>
        </div>
        <Tooltip label="Tutup"><button onClick={() => !saving && onClose()} className="modal-close" aria-label="Tutup"><X size={14} /></button></Tooltip>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="flex items-center gap-2">
          {([['new', 'Catat transfer baru'], ['existing', 'Tautkan yang sudah ada']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setTab(id); setError(''); }} className="px-3 py-1.5 rounded-xl text-xs font-bold"
              style={tab === id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}><Loader2 size={13} className="animate-spin" /> Memuat…</p>
        ) : loadError ? (
          <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>{loadError}</p>
        ) : tab === 'new' ? (
          <>
            <Field label="Dari Dompet" required>
              <SearchSelect value={fromId} onChange={setFromId} options={walletOptions} placeholder="– Pilih Dompet Asal –" searchPlaceholder="Cari dompet…" />
            </Field>
            <Field label="Ke Dompet" required>
              <SearchSelect value={toId} onChange={setToId} options={walletOptions.filter(o => o.value !== fromId)} placeholder="– Pilih Dompet Tujuan –" searchPlaceholder="Cari dompet…" />
            </Field>
            <Field label="Tanggal" required>
              <DateInput value={date} onChange={setDate} />
            </Field>
            <Field label="Jumlah (Rp)" required>
              <NumberInput value={amount} onChange={setAmount} placeholder="0" />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Default = sisa HPP closing. Transfer ini mengurangi saldo dompet asal seperti Transfer Antar Dompet biasa.
              </p>
            </Field>
            <Field label="Catatan (opsional)">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="input" style={{ resize: 'vertical', minHeight: 60 }} placeholder="cth: Setor HPP closing" />
            </Field>
          </>
        ) : candidates.length === 0 ? (
          <p className="text-xs py-3 text-center" style={{ color: 'var(--text-muted)' }}>Tidak ada transfer yang masih punya sisa belum ditautkan. Pilih &ldquo;Catat transfer baru&rdquo;.</p>
        ) : (
          <>
            <Field label="Transfer" required>
              <FilterSelect value={pickedId} onChange={pick} height={40} searchable={candidates.length > 8}
                options={[{ value: '', label: '– Pilih transfer –' }, ...candidates.map(c => ({
                  value: c.t.id,
                  label: `${fmtDate(c.t.date)} · ${walletName(c.t.fromWalletId)} → ${walletName(c.t.toWalletId)} · ${formatRp(c.t.amount)} (sisa ${formatRp(c.free)})`,
                }))]} />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Hanya transfer yang sebagian/seluruhnya belum ditautkan ke closing. Menautkan tidak mengubah saldo dompet.
              </p>
            </Field>
            <Field label="Nominal tautan (Rp)" required>
              <NumberInput value={linkAmount} onChange={setLinkAmount} placeholder="0" disabled={!picked} />
              {picked && <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Maks. {formatRp(Math.min(remaining, picked.free))}</p>}
            </Field>
          </>
        )}

        {error && (
          <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</p>
        )}
      </div>
      <div className="modal-footer">
        <button onClick={onClose} disabled={saving} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
        <button onClick={submit} disabled={saving || loading || !!loadError || !!problem} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? 'Menyimpan…' : tab === 'new' ? 'Catat & Tautkan' : 'Tautkan'}
        </button>
      </div>
    </Modal>
  );
}
