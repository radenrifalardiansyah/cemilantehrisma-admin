'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, RefreshCw, Percent, Coins, History, FileDown, Receipt, CheckCircle2, Landmark, X, ListChecks, Send, Building2, XCircle,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import TopbarPortal from '@/components/TopbarPortal';
import NumberInput from '@/components/NumberInput';
import SearchableSelect, { type SearchableSelectOption } from '@/components/SearchableSelect';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { useViewMode } from '@/lib/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import AdminFeeInvoicePDF, { type AdminFeeInvoiceData, type AdminFeePaymentInfo } from '@/lib/pdf/AdminFeeInvoicePDF';

type Channel = 'online' | 'kasir' | 'consignment';
type FeeType = 'percent' | 'fixed';
const CHANNELS: Channel[] = ['online', 'kasir', 'consignment'];
const CHANNEL_LABELS: Record<Channel, string> = {
  online: 'Penjualan Online', kasir: 'POS / Kasir', consignment: 'Konsinyasi',
};

interface RateEntry {
  id: string; type: FeeType; value: number;
  effectiveFrom: { seconds: number } | null; createdAt: { seconds: number } | null; createdBy: string;
}
interface TxnDetail {
  id: string; label: string; createdAt: { seconds: number } | null;
  revenue: number; feeAmount: number; invoiceId: string | null; invoiceNo: string | null;
}
interface ChannelBreakdown {
  channel: Channel; label: string; revenue: number; transactionCount: number; feeAmount: number;
  currentRate: { type: FeeType; value: number } | null;
  transactions: TxnDetail[];
}
interface ReportData { from: string; to: string; breakdown: ChannelBreakdown[]; totalRevenue: number; totalFee: number }
interface InvoiceRecord {
  id: string; invoiceNo: string; periodFrom: string; periodTo: string;
  breakdown: ChannelBreakdown[]; totalRevenue: number; totalFee: number;
  status: 'draft' | 'invoiced' | 'paid' | 'cancelled'; createdAt: { seconds: number } | null;
  paidAt: { seconds: number } | null; paidBy: string | null;
  cancelledAt: { seconds: number } | null; cancelledBy: string | null;
  note: string | null; dueDate: string | null;
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

// Tinggi seragam untuk semua kontrol di baris form rate (toggle tipe, input nilai, tanggal,
// tombol simpan) — tanpa ini, `<input>`/`<button>` bawaan browser tidak selalu render dengan
// tinggi yang sama walau pakai className yang sama (beda paling kentara pada `type="date"`).
const FORM_CTRL_H = 38;

const rateLabel = (rate: { type: FeeType; value: number } | null) => {
  if (!rate) return '–';
  return rate.type === 'percent' ? `${rate.value}%` : formatRp(rate.value);
};

const fmtDate = (ts: { seconds: number } | null) =>
  ts ? new Date(ts.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';

const fmtTime = (ts: { seconds: number } | null) =>
  ts ? new Date(ts.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '–';

// Bila superadmin mengganti rate lebih dari sekali untuk hari efektif yang sama, entri lama
// itu tidak pernah benar-benar berlaku (lihat rateAtTime di admin-fee.ts) — hanya entri dengan
// createdAt terakhir per hari yang dipakai, jadi itu satu-satunya yang perlu tampil di riwayat.
const dedupeHistoryByDay = (list: RateEntry[]): RateEntry[] => {
  const latestByDay = new Map<number, RateEntry>();
  for (const r of list) {
    if (!r.effectiveFrom) continue;
    const day = Math.floor(r.effectiveFrom.seconds / 86400);
    const existing = latestByDay.get(day);
    if (!existing || (r.createdAt?.seconds ?? 0) > (existing.createdAt?.seconds ?? 0)) {
      latestByDay.set(day, r);
    }
  }
  return Array.from(latestByDay.values());
};

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type SubTab = 'pengaturan' | 'laporan' | 'rekening';

export default function AdminFeeTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const [subTab, setSubTab] = useState<SubTab>('laporan');

  // ── Rates ──────────────────────────────────────────────────
  const [rates, setRates] = useState<Record<Channel, RateEntry[]>>({ online: [], kasir: [], consignment: [] });
  const [loadingRates, setLoadingRates] = useState(false);
  const todayIso = toISO(new Date());
  const [forms, setForms] = useState<Record<Channel, { type: FeeType; value: string; effectiveFrom: string }>>({
    online: { type: 'percent', value: '', effectiveFrom: todayIso },
    kasir: { type: 'percent', value: '', effectiveFrom: todayIso },
    consignment: { type: 'percent', value: '', effectiveFrom: todayIso },
  });
  const [savingChannel, setSavingChannel] = useState<Channel | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Channel | null>(null);

  const loadRates = useCallback(async () => {
    setLoadingRates(true);
    try {
      const r = await fetch('/api/admin-fee/rates', { headers });
      if (r.ok) setRates((await r.json() as { rates: Record<Channel, RateEntry[]> }).rates);
      else toast.error('Gagal memuat rate biaya admin.');
    } catch { toast.error('Gagal memuat rate biaya admin.'); }
    setLoadingRates(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  useEffect(() => { loadRates(); }, [loadRates]);

  // `rates[channel]` comes back sorted ascending by effectiveFrom (see getRateHistory) — the
  // last entry is always the one with the latest effectiveFrom, i.e. "current", regardless of
  // insertion order (superadmin can backdate a rate to before an existing entry via the form).
  const currentRateOf = (channel: Channel): RateEntry | null => {
    const list = rates[channel] ?? [];
    return list.length > 0 ? list[list.length - 1] : null;
  };

  const saveRate = async (channel: Channel) => {
    const form = forms[channel];
    const value = Number(form.value);
    if (!form.value || isNaN(value) || value < 0) { toast.error('Isi nilai biaya admin dengan benar.'); return; }
    if (!form.effectiveFrom) { toast.error('Isi tanggal efektif.'); return; }
    setSavingChannel(channel);
    try {
      const r = await fetch('/api/admin-fee/rates', {
        method: 'POST', headers, body: JSON.stringify({ channel, type: form.type, value, effectiveFrom: form.effectiveFrom }),
      });
      if (r.ok) {
        toast.success(`Rate ${CHANNEL_LABELS[channel]} berhasil disimpan, efektif sejak ${form.effectiveFrom}.`);
        setForms(f => ({ ...f, [channel]: { type: form.type, value: '', effectiveFrom: todayIso } }));
        loadRates();
      } else {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error ?? 'Gagal menyimpan rate.');
      }
    } catch { toast.error('Gagal menyimpan rate.'); }
    setSavingChannel(null);
  };

  // ── Laporan & Invoice ──────────────────────────────────────
  const now = new Date();
  const [from, setFrom] = useState(toISO(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(toISO(now));
  const [report, setReport] = useState<ReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [clientName, setClientName] = useState('Cemilan Teh Risma');
  const [txnModalChannel, setTxnModalChannel] = useState<Channel | null>(null);
  const [note, setNote] = useState('');
  // Jatuh tempo default 7 hari setelah akhir periode — bisa diubah manual per invoice.
  const [dueDate, setDueDate] = useState(toISO(new Date(now.getTime() + 7 * 86400000)));
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceView, setInvoiceView] = useViewMode('adminfee-invoices');
  const [channelView, setChannelView] = useViewMode('adminfee-channels');

  // ── Rekening Pembayaran (tujuan transfer Biaya Admin milik RMedia Solutions) ──
  const [paymentInfo, setPaymentInfo] = useState<AdminFeePaymentInfo>({ bankName: '', accountNumber: '', accountHolder: '' });
  const [loadingPaymentInfo, setLoadingPaymentInfo] = useState(false);
  const [savingPaymentInfo, setSavingPaymentInfo] = useState(false);
  const [bankOptions, setBankOptions] = useState<SearchableSelectOption[]>([]);

  const loadPaymentInfo = useCallback(async () => {
    setLoadingPaymentInfo(true);
    try {
      const r = await fetch('/api/admin-fee/payment-info', { headers });
      if (r.ok) {
        const d = await r.json() as { paymentInfo?: Partial<AdminFeePaymentInfo> };
        setPaymentInfo({ bankName: d.paymentInfo?.bankName ?? '', accountNumber: d.paymentInfo?.accountNumber ?? '', accountHolder: d.paymentInfo?.accountHolder ?? '' });
      }
    } catch { /* biarkan kosong, form tetap bisa diisi ulang */ }
    setLoadingPaymentInfo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  useEffect(() => { loadPaymentInfo(); }, [loadPaymentInfo]);

  useEffect(() => {
    fetch('/api/master-banks', { headers })
      .then(r => r.ok ? r.json() : null)
      .then((d: { banks?: { name: string }[] } | null) => {
        if (d?.banks) setBankOptions(d.banks.map(b => ({ value: b.name, label: b.name })));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  const savePaymentInfo = async () => {
    setSavingPaymentInfo(true);
    try {
      const r = await fetch('/api/admin-fee/payment-info', { method: 'PUT', headers, body: JSON.stringify(paymentInfo) });
      if (r.ok) toast.success('Rekening pembayaran berhasil disimpan.');
      else toast.error('Gagal menyimpan rekening pembayaran.');
    } catch { toast.error('Gagal menyimpan rekening pembayaran.'); }
    setSavingPaymentInfo(false);
  };

  useEffect(() => {
    fetch('/api/settings', { headers }).then(async r => {
      if (r.ok) {
        const { settings } = await r.json() as { settings?: { storeName?: string } };
        if (settings?.storeName?.trim()) setClientName(settings.storeName.trim());
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generasi request — cegah respons periode LAMA yang datang belakangan menimpa data periode
  // BARU yang sudah lebih dulu tampil.
  const loadReportIdRef = useRef(0);
  const loadReport = useCallback(async () => {
    const myLoadId = ++loadReportIdRef.current;
    setLoadingReport(true);
    try {
      const r = await fetch(`/api/admin-fee/report?from=${from}&to=${to}`, { headers });
      const data = r.ok ? await r.json() : null;
      if (myLoadId !== loadReportIdRef.current) return;
      if (data) setReport(data);
      else toast.error('Gagal memuat laporan biaya admin.');
    } catch { if (myLoadId === loadReportIdRef.current) toast.error('Gagal memuat laporan biaya admin.'); }
    if (myLoadId === loadReportIdRef.current) setLoadingReport(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds, from, to]);

  const loadInvoices = useCallback(async () => {
    setLoadingInvoices(true);
    try {
      const r = await fetch('/api/admin-fee/invoices', { headers });
      if (r.ok) setInvoices((await r.json() as { invoices: InvoiceRecord[] }).invoices);
    } catch {}
    setLoadingInvoices(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  // Hanya fetch sekali saat tab dibuka (pakai `from`/`to` default) — bukan tiap `from`/`to`
  // berubah, supaya ganti tanggal tidak langsung fetch sebelum tombol "Tampilkan" diklik.
  useEffect(() => { loadReport(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const downloadInvoicePdf = async (inv: { invoiceNo: string; periodFrom: string; periodTo: string; breakdown: ChannelBreakdown[]; totalRevenue: number; totalFee: number; status: string; note?: string | null; dueDate?: string | null }) => {
    const data: AdminFeeInvoiceData = {
      invoiceNo: inv.invoiceNo,
      clientName,
      periodFrom: inv.periodFrom,
      periodTo: inv.periodTo,
      dueDate: inv.dueDate,
      generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      status: inv.status,
      note: inv.note,
      paymentInfo,
      rows: inv.breakdown.map(b => ({ label: b.label, revenue: b.revenue, transactionCount: b.transactionCount, rateLabel: rateLabel(b.currentRate), feeAmount: b.feeAmount })),
      totalRevenue: inv.totalRevenue,
      totalFee: inv.totalFee,
    };
    const blob = await pdf(<AdminFeeInvoicePDF data={data} />).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${inv.invoiceNo}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const generateInvoice = async () => {
    if (!report) return;
    setGenerating(true);
    try {
      const r = await fetch('/api/admin-fee/invoices', { method: 'POST', headers, body: JSON.stringify({ from, to, note, dueDate }) });
      const d = await r.json();
      if (r.ok) {
        toast.success(`Invoice ${d.invoiceNo} berhasil dibuat.`);
        await downloadInvoicePdf({ invoiceNo: d.invoiceNo, periodFrom: from, periodTo: to, breakdown: report.breakdown, totalRevenue: report.totalRevenue, totalFee: report.totalFee, status: 'draft', note, dueDate });
        setNote('');
        setShowInvoiceModal(false);
        loadInvoices();
      } else {
        toast.error(d.error ?? 'Gagal membuat invoice.');
      }
    } catch { toast.error('Gagal membuat invoice.'); }
    setGenerating(false);
  };

  // draft -> invoiced: momen invoice ini benar-benar "ditagihkan" — baru dari sini invoice
  // muncul & bisa dibayar di halaman Tagihan Biaya Admin milik role admin (lihat filter status
  // di GET /api/admin-fee/invoices).
  const sendInvoice = async (inv: InvoiceRecord) => {
    const ok = await confirm({
      title: 'Tagihkan ke Admin', message: `Kirim invoice ${inv.invoiceNo} (${formatRp(inv.totalFee)}) agar terlihat dan bisa dibayar di halaman Tagihan Admin?`,
      confirmLabel: 'Tagihkan',
    });
    if (!ok) return;
    const r = await fetch(`/api/admin-fee/invoices/${inv.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'invoiced' }) });
    if (r.ok) { toast.success('Invoice berhasil ditagihkan ke admin.'); loadInvoices(); }
    else toast.error('Gagal menagihkan invoice.');
  };

  const markPaid = async (inv: InvoiceRecord) => {
    const ok = await confirm({ title: 'Tandai Lunas', message: `Tandai invoice ${inv.invoiceNo} sebagai sudah dibayar?`, confirmLabel: 'Tandai Lunas' });
    if (!ok) return;
    const r = await fetch(`/api/admin-fee/invoices/${inv.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'paid' }) });
    if (r.ok) { toast.success('Invoice ditandai lunas.'); loadInvoices(); }
    else toast.error('Gagal memperbarui status invoice.');
  };

  // Membatalkan melepas transactionIds invoice ini (lihat getInvoicedTransactionMap di
  // admin-fee.ts) — transaksinya jadi bisa masuk invoice lain lagi, bukan hilang permanen.
  const cancelInvoice = async (inv: InvoiceRecord) => {
    const ok = await confirm({
      title: 'Batalkan Invoice', danger: true,
      message: `Batalkan invoice ${inv.invoiceNo} (${formatRp(inv.totalFee)})? ${inv.status === 'invoiced' ? 'Invoice ini akan langsung hilang dari halaman Tagihan admin. ' : ''}Semua transaksi di dalamnya akan bisa ditagihkan ulang lewat invoice baru.`,
      confirmLabel: 'Batalkan',
    });
    if (!ok) return;
    const r = await fetch(`/api/admin-fee/invoices/${inv.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled' }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { toast.success('Invoice dibatalkan.'); loadInvoices(); }
    else toast.error(d.error ?? 'Gagal membatalkan invoice.');
  };

  const statusBadge = (status: InvoiceRecord['status']) => {
    if (status === 'paid') return <span className="badge badge-green">Lunas</span>;
    if (status === 'invoiced') return <span className="badge badge-amber">Terkirim</span>;
    if (status === 'cancelled') return <span className="badge badge-red">Dibatalkan</span>;
    return <span className="badge badge-gray">Draft</span>;
  };

  // Dipakai baik di tampilan kartu maupun tabel Riwayat Invoice, supaya tombol aksi tidak
  // dobel-tulis dan selalu konsisten antara kedua tampilan.
  const invoiceActions = (inv: InvoiceRecord) => (
    <>
      <button onClick={() => downloadInvoicePdf(inv)} className="btn-ghost h-8 px-2.5 text-xs flex items-center gap-1.5">
        <FileDown size={13} /> PDF
      </button>
      {inv.status === 'draft' && (
        <button onClick={() => sendInvoice(inv)} className="btn-primary h-8 px-2.5 text-xs flex items-center gap-1.5">
          <Send size={13} /> Tagihkan
        </button>
      )}
      {inv.status === 'invoiced' && (
        <button onClick={() => markPaid(inv)} className="btn-ghost h-8 px-2.5 text-xs flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
          <CheckCircle2 size={13} /> Tandai Lunas
        </button>
      )}
      {(inv.status === 'draft' || inv.status === 'invoiced') && (
        <button onClick={() => cancelInvoice(inv)} className="btn-ghost h-8 px-2.5 text-xs flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
          <XCircle size={13} /> Batal
        </button>
      )}
    </>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <TopbarPortal>
        <button onClick={() => { loadRates(); loadReport(); loadInvoices(); }} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center">
          <RefreshCw size={14} className={loadingReport || loadingRates || loadingInvoices ? 'animate-spin' : ''} />
        </button>
      </TopbarPortal>

      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          <Landmark size={18} />
        </div>
        <div>
          <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Biaya Admin — Internal RMedia Solutions</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Halaman ini hanya terlihat oleh Super Admin, tidak dapat dilihat/diatur oleh role lain.</p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--surface-2)' }}>
        {([['laporan', 'Laporan & Invoice'], ['pengaturan', 'Pengaturan Rate'], ['rekening', 'Rekening Pembayaran']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
            style={{
              background: subTab === id ? 'var(--surface)' : 'transparent',
              color: subTab === id ? 'var(--accent)' : 'var(--text-muted)',
              boxShadow: subTab === id ? '0 1px 4px rgba(30,16,8,0.10)' : 'none',
            }}>
            {label}
          </button>
        ))}
      </div>

      {subTab === 'pengaturan' && (
        <div className="space-y-4">
          {CHANNELS.map(channel => {
            const current = currentRateOf(channel);
            const history = dedupeHistoryByDay(rates[channel] ?? []);
            return (
              <div key={channel} className="card overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: '1px solid var(--border-2)' }}>
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{CHANNEL_LABELS[channel]}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Rate saat ini: <span className="font-bold" style={{ color: 'var(--accent)' }}>{rateLabel(current)}</span>
                    </p>
                  </div>
                  <button onClick={() => setExpandedHistory(h => h === channel ? null : channel)} className="btn-ghost text-xs h-8 px-3 flex items-center gap-1.5">
                    <History size={13} /> Riwayat ({history.length})
                  </button>
                </div>

                <div className="p-5 flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Tipe</label>
                    <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-2)', height: FORM_CTRL_H }}>
                      {([['percent', 'Persen', Percent], ['fixed', 'Nominal', Coins]] as const).map(([id, label, Icon]) => (
                        <button key={id} onClick={() => setForms(f => ({ ...f, [channel]: { ...f[channel], type: id } }))}
                          className="h-full px-3 rounded-md text-xs font-bold flex items-center gap-1.5 transition-colors"
                          style={{
                            background: forms[channel].type === id ? 'var(--surface)' : 'transparent',
                            color: forms[channel].type === id ? 'var(--accent)' : 'var(--text-muted)',
                          }}>
                          <Icon size={12} /> {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="w-full sm:w-[160px] flex-shrink-0">
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Nilai</label>
                    <NumberInput
                      value={forms[channel].value}
                      onChange={v => setForms(f => ({ ...f, [channel]: { ...f[channel], value: v } }))}
                      placeholder={forms[channel].type === 'percent' ? 'cth. 3' : 'cth. 2000'}
                      style={{ width: '100%', height: FORM_CTRL_H, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div className="w-full sm:w-[150px] flex-shrink-0">
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Efektif Sejak</label>
                    <input type="date" value={forms[channel].effectiveFrom} max={todayIso}
                      onChange={e => setForms(f => ({ ...f, [channel]: { ...f[channel], effectiveFrom: e.target.value } }))}
                      className="input" style={{ width: '100%', height: FORM_CTRL_H, boxSizing: 'border-box' }} />
                  </div>
                  <button onClick={() => saveRate(channel)} disabled={savingChannel === channel} className="btn-primary px-4 text-xs"
                    style={{ height: FORM_CTRL_H }}>
                    {savingChannel === channel ? <Loader2 size={14} className="animate-spin" /> : 'Simpan Rate'}
                  </button>
                </div>
                <p className="px-5 pb-4 text-xs" style={{ color: 'var(--text-muted)', marginTop: -12 }}>
                  Rate berlaku untuk transaksi mulai tanggal ini — bisa dimundurkan untuk mencakup transaksi yang sudah terjadi di periode berjalan.
                </p>

                {expandedHistory === channel && (
                  <div className="px-5 pb-5">
                    {history.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Belum ada riwayat rate.</p>
                    ) : (
                      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-2)' }}>
                        {history.slice().sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)).map(r => {
                          const isCurrent = current?.id === r.id;
                          return (
                            <div key={r.id} className="px-4 py-2.5 grid items-center text-xs" style={{
                              gridTemplateColumns: '1fr 90px 1fr',
                              columnGap: 12,
                              borderTop: '1px solid var(--border-2)',
                              background: isCurrent ? 'var(--accent-bg)' : undefined,
                            }}>
                              <span className="flex items-center gap-2" style={{ color: isCurrent ? 'var(--accent)' : 'var(--text-muted)' }}>
                                {isCurrent && <span className="badge badge-green">Aktif</span>}
                                {isCurrent ? 'Efektif' : 'Sebelumnya'} {fmtDate(r.effectiveFrom)} · {fmtTime(r.createdAt)}
                              </span>
                              <span className="font-bold text-center" style={{ color: isCurrent ? 'var(--accent)' : 'var(--text-primary)' }}>{r.type === 'percent' ? `${r.value}%` : formatRp(r.value)}</span>
                              <span className="text-right" style={{ color: 'var(--text-muted)' }}>oleh {r.createdBy}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {subTab === 'rekening' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                <Building2 size={16} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Rekening Tujuan Pembayaran</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Rekening RMedia Solutions sendiri — tempat admin transfer Biaya Admin. Tampil di halaman Tagihan admin & di PDF invoice.</p>
              </div>
            </div>
            {loadingPaymentInfo ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Memuat…</p>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Nama Bank</label>
                  <SearchableSelect
                    value={paymentInfo.bankName}
                    onChange={v => setPaymentInfo(p => ({ ...p, bankName: v }))}
                    options={bankOptions}
                    placeholder="Pilih Bank"
                    searchPlaceholder="Cari bank…"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Nomor Rekening</label>
                  <input value={paymentInfo.accountNumber} onChange={e => setPaymentInfo(p => ({ ...p, accountNumber: e.target.value }))}
                    placeholder="cth. 1234567890" className="input w-full" style={{ height: FORM_CTRL_H, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Atas Nama</label>
                  <input value={paymentInfo.accountHolder} onChange={e => setPaymentInfo(p => ({ ...p, accountHolder: e.target.value }))}
                    placeholder="cth. PT. Eleven Digital Indonesia" className="input w-full" style={{ height: FORM_CTRL_H, boxSizing: 'border-box' }} />
                </div>
                <button onClick={savePaymentInfo} disabled={savingPaymentInfo} className="btn-primary px-4 text-xs flex items-center gap-1.5" style={{ height: FORM_CTRL_H }}>
                  {savingPaymentInfo ? <Loader2 size={14} className="animate-spin" /> : 'Simpan Rekening'}
                </button>
              </>
            )}
          </div>

          <div className="card p-5 space-y-3">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Pratinjau tampilan untuk Admin</p>
            {paymentInfo.bankName || paymentInfo.accountNumber ? (
              <div className="p-4 rounded-xl flex items-center gap-3 flex-wrap" style={{ border: '1px solid var(--success)' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                  <Building2 size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-muted)' }}>Transfer Biaya Admin ke</p>
                  <p className="text-sm font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>
                    {paymentInfo.bankName || '–'} — {paymentInfo.accountNumber || '–'} <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>a.n. {paymentInfo.accountHolder || '–'}</span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Isi rekening di sebelah kiri untuk melihat pratinjaunya di sini.</p>
            )}
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Begini rekening ini akan muncul di halaman Tagihan Biaya Admin milik Admin, dan pada bagian pembayaran di PDF invoice.
            </p>
          </div>
        </div>
      )}

      {subTab === 'laporan' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="w-full sm:w-[160px] flex-shrink-0">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Dari</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" style={{ width: '100%', height: FORM_CTRL_H, boxSizing: 'border-box' }} />
              </div>
              <div className="w-full sm:w-[160px] flex-shrink-0">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Sampai</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input" style={{ width: '100%', height: FORM_CTRL_H, boxSizing: 'border-box' }} />
              </div>
              <button onClick={loadReport} disabled={loadingReport} className="btn-ghost px-4 text-xs flex items-center gap-1.5" style={{ height: FORM_CTRL_H }}>
                {loadingReport ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Tampilkan
              </button>
              <div className="flex-1" />
              <button onClick={() => setShowInvoiceModal(true)} disabled={generating || !report || report.totalFee <= 0} className="btn-primary px-4 text-xs flex items-center gap-1.5" style={{ height: FORM_CTRL_H }}>
                {generating ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Buat Invoice
              </button>
            </div>
          </div>

          {report && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="card p-4">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Total Omzet</p>
                  <p className="text-xl font-extrabold tabular mt-1" style={{ color: 'var(--text-primary)' }}>{formatRp(report.totalRevenue)}</p>
                </div>
                <div className="card p-4">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Total Transaksi</p>
                  <p className="text-xl font-extrabold tabular mt-1" style={{ color: 'var(--text-primary)' }}>
                    {report.breakdown.reduce((s, b) => s + b.transactionCount, 0)}
                  </p>
                </div>
                <div className="card p-4" style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)' }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Total Biaya Admin</p>
                  <p className="text-xl font-extrabold tabular mt-1" style={{ color: 'var(--accent)' }}>{formatRp(report.totalFee)}</p>
                </div>
              </div>

              <div className="flex items-center justify-end px-1">
                <ViewToggle mode={channelView} onChange={setChannelView} height={FORM_CTRL_H} />
              </div>

              {channelView === 'table' ? (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: 'var(--surface-2)' }}>
                          <th className="text-left px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Channel</th>
                          <th className="text-right px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Omzet</th>
                          <th className="text-center px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Transaksi</th>
                          <th className="text-right px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Rate</th>
                          <th className="text-right px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Biaya Admin</th>
                          <th className="text-center px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.breakdown.map(b => (
                          <tr key={b.channel} style={{ borderTop: '1px solid var(--border-2)' }}>
                            <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{b.label}</td>
                            <td className="px-4 py-3 text-right tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(b.revenue)}</td>
                            <td className="px-4 py-3 text-center tabular" style={{ color: 'var(--text-muted)' }}>{b.transactionCount}</td>
                            <td className="px-4 py-3 text-right tabular" style={{ color: 'var(--text-muted)' }}>{rateLabel(b.currentRate)}</td>
                            <td className="px-4 py-3 text-right tabular font-bold" style={{ color: 'var(--accent)' }}>{formatRp(b.feeAmount)}</td>
                            <td className="px-4 py-3 text-center">
                              <button onClick={() => setTxnModalChannel(b.channel)} disabled={b.transactionCount === 0}
                                className="btn-ghost h-7 px-2.5 text-xs flex items-center gap-1.5 mx-auto" style={{ opacity: b.transactionCount === 0 ? 0.4 : 1 }}>
                                <ListChecks size={12} /> Detail
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {report.breakdown.map(b => (
                    <div key={b.channel} className="card p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{b.label}</p>
                        <span className="text-xs font-semibold tabular" style={{ color: 'var(--text-muted)' }}>{b.transactionCount} transaksi</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Omzet</p>
                          <p className="text-sm font-bold tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(b.revenue)}</p>
                        </div>
                        <div>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Rate</p>
                          <p className="text-sm font-bold tabular" style={{ color: 'var(--text-primary)' }}>{rateLabel(b.currentRate)}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Biaya Admin</p>
                        <p className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(b.feeAmount)}</p>
                      </div>
                      <button onClick={() => setTxnModalChannel(b.channel)} disabled={b.transactionCount === 0}
                        className="btn-ghost h-8 px-2.5 text-xs flex items-center gap-1.5 w-full justify-center"
                        style={{ opacity: b.transactionCount === 0 ? 0.4 : 1, borderTop: '1px solid var(--border-2)', marginTop: 4, paddingTop: 10 }}>
                        <ListChecks size={12} /> Detail Transaksi
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
              <div className="flex items-center gap-2">
                <Receipt size={15} style={{ color: 'var(--accent)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Riwayat Invoice</p>
              </div>
              {invoices.length > 0 && <ViewToggle mode={invoiceView} onChange={setInvoiceView} height={FORM_CTRL_H} />}
            </div>
            {invoices.length === 0 ? (
              <div className="card">
                <p className="px-5 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  {loadingInvoices ? 'Memuat…' : 'Belum ada invoice dibuat.'}
                </p>
              </div>
            ) : invoiceView === 'table' ? (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <th className="text-left px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Invoice</th>
                        <th className="text-left px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Periode</th>
                        <th className="text-left px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Keterangan</th>
                        <th className="text-center px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Status</th>
                        <th className="text-right px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Total</th>
                        <th className="text-center px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(inv => (
                        <tr key={inv.id} style={{ borderTop: '1px solid var(--border-2)', opacity: inv.status === 'cancelled' ? 0.65 : 1 }}>
                          <td className="px-4 py-3 font-bold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{inv.invoiceNo}</td>
                          <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{inv.periodFrom} – {inv.periodTo}</td>
                          <td className="px-4 py-3" style={{ color: 'var(--text-muted)', maxWidth: 220 }}>
                            {inv.dueDate && inv.status !== 'paid' && inv.status !== 'cancelled' && (
                              <p className="text-xs font-semibold" style={{ color: inv.dueDate < todayIso ? 'var(--danger)' : 'var(--text-muted)' }}>
                                Jatuh tempo {fmtDate({ seconds: new Date(inv.dueDate).getTime() / 1000 })}{inv.dueDate < todayIso ? ' — Terlambat' : ''}
                              </p>
                            )}
                            {inv.status === 'paid' && inv.paidAt && (
                              <p className="text-xs" style={{ color: 'var(--success)' }}>
                                Dibayar {new Date(inv.paidAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}{inv.paidBy ? ` oleh ${inv.paidBy}` : ''}
                              </p>
                            )}
                            {inv.status === 'cancelled' && inv.cancelledAt && (
                              <p className="text-xs" style={{ color: 'var(--danger)' }}>
                                Dibatalkan {new Date(inv.cancelledAt.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}{inv.cancelledBy ? ` oleh ${inv.cancelledBy}` : ''}
                              </p>
                            )}
                            {inv.note && <p className="text-xs italic truncate" title={inv.note}>“{inv.note}”</p>}
                          </td>
                          <td className="px-4 py-3 text-center">{statusBadge(inv.status)}</td>
                          <td className="px-4 py-3 text-right tabular font-extrabold" style={{ color: 'var(--accent)' }}>{formatRp(inv.totalFee)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 flex-wrap justify-center">
                              {invoiceActions(inv)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {invoices.map(inv => (
                  <div key={inv.id} className="card p-4 space-y-2.5" style={{ opacity: inv.status === 'cancelled' ? 0.65 : 1 }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{inv.invoiceNo}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{inv.periodFrom} – {inv.periodTo}</p>
                      </div>
                      {statusBadge(inv.status)}
                    </div>

                    <p className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(inv.totalFee)}</p>

                    {inv.dueDate && inv.status !== 'paid' && inv.status !== 'cancelled' && (
                      <p className="text-xs font-semibold" style={{ color: inv.dueDate < todayIso ? 'var(--danger)' : 'var(--text-muted)' }}>
                        Jatuh tempo {fmtDate({ seconds: new Date(inv.dueDate).getTime() / 1000 })}
                        {inv.dueDate < todayIso ? ' — Terlambat' : ''}
                      </p>
                    )}
                    {inv.status === 'paid' && inv.paidAt && (
                      <p className="text-xs" style={{ color: 'var(--success)' }}>
                        Dibayar {new Date(inv.paidAt.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {inv.paidBy ? ` oleh ${inv.paidBy}` : ''}
                      </p>
                    )}
                    {inv.status === 'cancelled' && inv.cancelledAt && (
                      <p className="text-xs" style={{ color: 'var(--danger)' }}>
                        Dibatalkan {new Date(inv.cancelledAt.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {inv.cancelledBy ? ` oleh ${inv.cancelledBy}` : ''}
                      </p>
                    )}
                    {inv.note && (
                      <p className="text-xs italic truncate" style={{ color: 'var(--text-muted)' }} title={inv.note}>
                        “{inv.note}”
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 flex-wrap pt-1" style={{ borderTop: '1px solid var(--border-2)', marginTop: 4, paddingTop: 10 }}>
                      {invoiceActions(inv)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {txnModalChannel && report && (() => {
        const b = report.breakdown.find(x => x.channel === txnModalChannel);
        if (!b) return null;
        return (
          <div className="modal-overlay" onClick={() => setTxnModalChannel(null)}>
            <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
              <div className="modal-accent" />
              <span className="modal-handle" />
              <div className="modal-header">
                <div className="modal-header-left">
                  <div className="modal-icon"><ListChecks size={17} /></div>
                  <div>
                    <p className="modal-title">Transaksi — {b.label}</p>
                    <p className="modal-subtitle">{from} – {to} · {b.transactionCount} transaksi</p>
                  </div>
                </div>
                <button onClick={() => setTxnModalChannel(null)} className="modal-close"><X size={14} /></button>
              </div>
              <div className="modal-body">
                {b.transactions.length === 0 ? (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>Tidak ada transaksi di periode ini.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: 'var(--surface-2)' }}>
                          <th className="text-center px-3 py-2.5 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>No.</th>
                          <th className="text-left px-3 py-2.5 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Tanggal</th>
                          <th className="text-left px-3 py-2.5 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Referensi</th>
                          <th className="text-right px-3 py-2.5 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Omzet</th>
                          <th className="text-right px-3 py-2.5 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Biaya Admin</th>
                          <th className="text-center px-3 py-2.5 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.transactions.slice().sort((x, y) => (x.createdAt?.seconds ?? 0) - (y.createdAt?.seconds ?? 0)).map((t, i) => (
                          <tr key={t.id} style={{ borderTop: '1px solid var(--border-2)' }}>
                            <td className="px-3 py-2.5 text-center tabular" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{fmtDate(t.createdAt)}</td>
                            <td className="px-3 py-2.5 font-semibold truncate" style={{ color: 'var(--text-primary)', maxWidth: 180 }}>{t.label}</td>
                            <td className="px-3 py-2.5 text-right tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(t.revenue)}</td>
                            <td className="px-3 py-2.5 text-right tabular font-bold" style={{ color: 'var(--accent)' }}>{formatRp(t.feeAmount)}</td>
                            <td className="px-3 py-2.5 text-center">
                              {t.invoiceNo ? (
                                <span className="badge badge-green" title={t.invoiceNo}>Sudah Ditagihkan</span>
                              ) : (
                                <span className="badge badge-gray">Belum Ditagihkan</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {showInvoiceModal && report && (
        <div className="modal-overlay" onClick={() => !generating && setShowInvoiceModal(false)}>
          <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><FileDown size={17} /></div>
                <div>
                  <p className="modal-title">Buat Invoice Biaya Admin</p>
                  <p className="modal-subtitle">{from} – {to} · {formatRp(report.totalFee)}</p>
                </div>
              </div>
              <button onClick={() => !generating && setShowInvoiceModal(false)} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body space-y-3">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Angka ini akan terkunci dan tidak berubah walau rate diubah kemudian.
              </p>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Jatuh Tempo</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input" style={{ width: '100%', maxWidth: 160, height: FORM_CTRL_H, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Catatan untuk Admin (opsional)</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                  placeholder="cth. Ada penyesuaian rate konsinyasi bulan ini, silakan hubungi kami jika ada pertanyaan."
                  className="input w-full" style={{ resize: 'vertical', boxSizing: 'border-box' }} />
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  Catatan ini ikut tersimpan di invoice, tampil di halaman Tagihan admin, dan tercetak di PDF.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowInvoiceModal(false)} disabled={generating} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0', opacity: generating ? 0.5 : 1 }}>
                Batal
              </button>
              <button onClick={generateInvoice} disabled={generating} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '10px 0', opacity: generating ? 0.75 : 1 }}>
                {generating ? <Loader2 size={15} className="animate-spin" /> : 'Buat Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
