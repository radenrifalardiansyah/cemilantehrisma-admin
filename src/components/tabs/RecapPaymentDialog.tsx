'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, HandCoins, Loader2, Undo2, X } from 'lucide-react';
import Modal from '@/components/Modal';
import Tooltip from '@/components/Tooltip';
import Field from '@/components/Field';
import NumberInput from '@/components/NumberInput';
import SearchSelect from '@/components/SearchSelect';
import { DateInput } from '@/components/DateTimeInput';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { activeWalletOptions, useWalletBalances, useWallets } from '@/lib/useWallets';
import { formatRp } from '@/lib/format';
import { PAY_TOLERANCE } from '@/lib/recap-payments-core';

export interface RecapPayTarget {
  id: string; locationName: string; total: number; remaining: number; walletId: string | null;
}
interface PaymentItem { id: string; amount: number; date: string; walletId: string | null; note: string; createdBy: string | null; voided: boolean; closed: boolean }

const FETCH_TIMEOUT_MS = 30_000;
// Hari ini menurut WIB (sama dengan server) — bukan zona waktu browser, supaya tanggal hari ini tak ditolak sebagai masa depan.
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

// fetch ber-timeout 30 detik; pemanggil menangani error.
async function api(url: string, creds: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, signal: ctrl.signal });
    const data = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
    return { ok: res.ok, data };
  } finally { clearTimeout(timer); }
}

// Dialog pembayaran sebagian satu rekap Mitra: nominal (default sisa), tanggal, dompet tujuan, catatan; plus riwayat
// pembayaran (batalkan per pembayaran). Rekap lunas / tanpa izin = mode riwayat saja. `canEdit` = izin 'consignment' 'edit'.
// Selisih yang tidak akan dibayar mitra (diskon/potongan) dicatat lewat "Biaya lain-lain" di rekap, bukan lewat dialog ini.
export default function RecapPaymentDialog({ creds, recap, canEdit, onClose, onDone }: {
  creds: string; recap: RecapPayTarget; canEdit: boolean; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const wallets = useWallets(creds);
  const [balances, refetchBalances] = useWalletBalances(creds, wallets);
  const walletOptions = useMemo(() => activeWalletOptions(wallets, balances), [wallets, balances]);

  const [remaining, setRemaining] = useState(recap.remaining);
  const [total, setTotal] = useState(recap.total);
  const maxPay = Math.max(0, Math.floor(remaining + 0.005));
  const [amount, setAmount] = useState(String(maxPay));
  const [date, setDate] = useState(todayISO());
  const [walletId, setWalletId] = useState(recap.walletId ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loadingPay, setLoadingPay] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const applyPayments = useCallback((data: Record<string, unknown>) => {
    setPayments(data.payments as PaymentItem[]);
    const rem = Number(data.remaining) || 0;
    setRemaining(rem);
    setTotal(Number(data.total) || 0);
    setAmount(String(Math.max(0, Math.floor(rem + 0.005))));
  }, []);
  const loadPayments = useCallback(async () => {
    try {
      const { ok, data } = await api(`/api/consignment/recap/${recap.id}/payments`, creds);
      if (ok) applyPayments(data);
    } catch (err) {
      console.error('Gagal memuat riwayat pembayaran rekap', err);
    }
  }, [creds, recap.id, applyPayments]);
  // Muat awal (state diubah setelah await, bukan sinkron di efek).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ok, data } = await api(`/api/consignment/recap/${recap.id}/payments`, creds);
        if (ok && !cancelled) applyPayments(data);
      } catch (err) {
        console.error('Gagal memuat riwayat pembayaran rekap', err);
      } finally { if (!cancelled) setLoadingPay(false); }
    })();
    return () => { cancelled = true; };
  }, [creds, recap.id, applyPayments]);

  const amountNum = parseFloat(amount) || 0;
  const walletBalance = balances[walletId] ?? 0;
  const settled = remaining - amountNum <= PAY_TOLERANCE;
  const paidTotal = Math.max(0, total - remaining);
  const problem = remaining <= PAY_TOLERANCE ? 'Rekap ini sudah lunas.'
    : amountNum <= 0 ? 'Nominal harus lebih dari 0.'
    : amountNum > remaining + 0.005 ? `Nominal melebihi sisa piutang (${formatRp(remaining)}).`
    : !walletId ? 'Pilih dompet tujuan.'
    : !date ? 'Tanggal bayar wajib diisi.' : '';

  const submit = async () => {
    if (saving) return;
    if (problem) { setError(problem); return; }
    setSaving(true); setError('');
    try {
      const { ok, data } = await api(`/api/consignment/recap/${recap.id}/payments`, creds, {
        method: 'POST', body: JSON.stringify({ amount: amountNum, date, walletId, note: note.trim() }),
      });
      if (!ok) { const msg = data.error ?? 'Gagal mencatat pembayaran.'; setError(msg); toast.error(msg); return; }
      toast.success(data.settled ? 'Pembayaran dicatat — rekap lunas.' : `Pembayaran dicatat. Sisa piutang ${formatRp(Number(data.remaining) || 0)}.`);
      refetchBalances();
      await onDone();
      onClose();
    } catch (err) {
      console.error('Gagal mencatat pembayaran rekap', err);
      setError('Gagal mencatat pembayaran.'); toast.error('Gagal mencatat pembayaran.');
    } finally { setSaving(false); }
  };

  const cancelPayment = async (p: PaymentItem) => {
    if (!await confirm({ message: `Batalkan pembayaran ${formatRp(p.amount)} (${p.date})? Uangnya keluar lagi dari dompet tujuan.`, danger: true })) return;
    setCancelingId(p.id);
    try {
      const { ok, data } = await api(`/api/consignment/recap/${recap.id}/payments/${p.id}`, creds, { method: 'DELETE' });
      if (!ok) { toast.error(data.error ?? 'Gagal membatalkan pembayaran.'); return; }
      toast.success('Pembayaran dibatalkan.');
      refetchBalances();
      await loadPayments();
      await onDone();
    } catch (err) {
      console.error('Gagal membatalkan pembayaran rekap', err);
      toast.error('Gagal membatalkan pembayaran.');
    } finally { setCancelingId(null); }
  };

  const close = () => { if (!saving && !cancelingId) onClose(); };
  const active = payments.filter(p => !p.voided);
  const walletName = (id: string | null) => wallets.find(w => w.id === id)?.name ?? '';

  return (
    <Modal onClose={close} className="modal-sm">
      <div className="modal-accent" />
      <span className="modal-handle" />
      <div className="modal-header">
        <div className="modal-header-left">
          <div className="modal-icon"><HandCoins size={17} /></div>
          <div>
            <p className="modal-title">{canEdit && remaining > PAY_TOLERANCE ? 'Bayar Rekap' : 'Detail Pembayaran'}</p>
            <p className="modal-subtitle">{recap.locationName} · total {formatRp(total)} · {remaining > PAY_TOLERANCE ? `sisa ${formatRp(remaining)}` : 'lunas'}</p>
          </div>
        </div>
        <Tooltip label="Tutup"><button onClick={close} className="modal-close" aria-label="Tutup"><X size={14} /></button></Tooltip>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {remaining > PAY_TOLERANCE && paidTotal > PAY_TOLERANCE && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sudah dibayar {formatRp(paidTotal)} dari {formatRp(total)}.</p>
        )}
        {canEdit && remaining > PAY_TOLERANCE && (
          <>
            <Field label="Nominal diterima (Rp)" required>
              <NumberInput value={amount} onChange={setAmount} placeholder="0" />
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <p className="text-[11px]" style={{ color: settled ? 'var(--success)' : 'var(--text-muted)' }}>
                  {settled ? 'Menerima seluruh sisa — rekap menjadi Lunas.' : `Sisa setelah ini ${formatRp(Math.max(0, remaining - amountNum))} — tetap tercatat sebagai piutang.`}
                </p>
                <button type="button" onClick={() => setAmount(String(maxPay))} className="text-[11px] font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>Bayar semua sisa</button>
              </div>
            </Field>
            <Field label="Tanggal bayar" required><DateInput value={date} onChange={setDate} /></Field>
            <Field label="Uang masuk ke dompet" required>
              <SearchSelect value={walletId} onChange={setWalletId} options={walletOptions} placeholder="– Pilih Dompet –" searchPlaceholder="Cari dompet…" />
              {walletId && <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Saldo saat ini: {formatRp(walletBalance)}</p>}
            </Field>
            <Field label="Catatan (opsional)">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} className="input" style={{ resize: 'vertical', minHeight: 60 }} placeholder="cth: Transfer termin 1" />
            </Field>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Untuk diskon/potongan yang tidak akan dibayar mitra, ubah rekap dan isi &ldquo;Biaya lain-lain&rdquo; — bukan dengan membayar sebagian.</p>
          </>
        )}
        {!canEdit && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Anda hanya punya akses lihat — tidak bisa mencatat pembayaran.</p>}
        {remaining <= PAY_TOLERANCE && !loadingPay && <p className="text-xs font-semibold" style={{ color: 'var(--success)' }}>Rekap ini sudah lunas.</p>}

        <div>
          <p className="field-label">Riwayat pembayaran {active.length > 0 && `(${active.length})`}</p>
          {loadingPay ? (
            <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}><Loader2 size={13} className="animate-spin" /> Memuat…</p>
          ) : payments.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{remaining <= PAY_TOLERANCE ? 'Rekap ini lunas tanpa cicilan tercatat.' : 'Belum ada pembayaran.'}</p>
          ) : (
            <div className="rounded-xl divide-y divide-[var(--border-2)]" style={{ border: '1px solid var(--border-2)' }}>
              {payments.map(p => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2" style={{ opacity: p.voided ? 0.5 : 1 }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold tabular" style={{ color: 'var(--text-primary)', textDecoration: p.voided ? 'line-through' : undefined }}>
                      {formatRp(p.amount)} <span className="font-medium" style={{ color: 'var(--text-muted)' }}>· {p.date}{walletName(p.walletId) ? ` · ${walletName(p.walletId)}` : ''}{p.voided ? ' · dibatalkan' : ''}{p.closed && !p.voided ? ' · sudah closing' : ''}</span>
                    </p>
                    {p.note && <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{p.note}</p>}
                  </div>
                  {canEdit && !p.voided && !p.closed && (
                    <Tooltip label="Batalkan pembayaran">
                      <button onClick={() => cancelPayment(p)} disabled={cancelingId === p.id} aria-label="Batalkan pembayaran"
                        className="w-10 h-10 sm:w-[30px] sm:h-[30px] rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                        {cancelingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                      </button>
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p style={{ fontSize: 12, fontWeight: 500, padding: '8px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</p>
        )}
      </div>
      <div className="modal-footer">
        <button onClick={close} disabled={saving} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>
        {canEdit && remaining > PAY_TOLERANCE && (
          <button onClick={submit} disabled={saving || !!problem} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Menyimpan…' : settled ? 'Terima & Lunasi' : 'Catat Pembayaran'}
          </button>
        )}
      </div>
    </Modal>
  );
}
