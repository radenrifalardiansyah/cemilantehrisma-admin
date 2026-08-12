'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, RefreshCw, Percent, Coins, History, FileDown, Receipt, CheckCircle2, Landmark, X, ListChecks,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import TopbarPortal from '@/components/TopbarPortal';
import NumberInput from '@/components/NumberInput';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import AdminFeeInvoicePDF, { type AdminFeeInvoiceData } from '@/lib/pdf/AdminFeeInvoicePDF';

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
  status: 'draft' | 'invoiced' | 'paid'; createdAt: { seconds: number } | null;
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

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

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type SubTab = 'pengaturan' | 'laporan';

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

  useEffect(() => {
    fetch('/api/settings', { headers }).then(async r => {
      if (r.ok) {
        const { settings } = await r.json() as { settings?: { storeName?: string } };
        if (settings?.storeName?.trim()) setClientName(settings.storeName.trim());
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    try {
      const r = await fetch(`/api/admin-fee/report?from=${from}&to=${to}`, { headers });
      if (r.ok) setReport(await r.json());
      else toast.error('Gagal memuat laporan biaya admin.');
    } catch { toast.error('Gagal memuat laporan biaya admin.'); }
    setLoadingReport(false);
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

  const downloadInvoicePdf = async (inv: { invoiceNo: string; periodFrom: string; periodTo: string; breakdown: ChannelBreakdown[]; totalRevenue: number; totalFee: number; status: string }) => {
    const data: AdminFeeInvoiceData = {
      invoiceNo: inv.invoiceNo,
      clientName,
      periodFrom: inv.periodFrom,
      periodTo: inv.periodTo,
      generatedAt: new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      status: inv.status,
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
    const ok = await confirm({
      title: 'Buat Invoice Biaya Admin',
      message: `Buat invoice untuk periode ${from} – ${to} sebesar ${formatRp(report.totalFee)}? Angka ini akan terkunci dan tidak berubah walau rate diubah kemudian.`,
      confirmLabel: 'Buat Invoice',
    });
    if (!ok) return;
    setGenerating(true);
    try {
      const r = await fetch('/api/admin-fee/invoices', { method: 'POST', headers, body: JSON.stringify({ from, to }) });
      const d = await r.json();
      if (r.ok) {
        toast.success(`Invoice ${d.invoiceNo} berhasil dibuat.`);
        await downloadInvoicePdf({ invoiceNo: d.invoiceNo, periodFrom: from, periodTo: to, breakdown: report.breakdown, totalRevenue: report.totalRevenue, totalFee: report.totalFee, status: 'draft' });
        loadInvoices();
      } else {
        toast.error(d.error ?? 'Gagal membuat invoice.');
      }
    } catch { toast.error('Gagal membuat invoice.'); }
    setGenerating(false);
  };

  const markPaid = async (inv: InvoiceRecord) => {
    const ok = await confirm({ title: 'Tandai Lunas', message: `Tandai invoice ${inv.invoiceNo} sebagai sudah dibayar?`, confirmLabel: 'Tandai Lunas' });
    if (!ok) return;
    const r = await fetch(`/api/admin-fee/invoices/${inv.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'paid' }) });
    if (r.ok) { toast.success('Invoice ditandai lunas.'); loadInvoices(); }
    else toast.error('Gagal memperbarui status invoice.');
  };

  const statusBadge = (status: InvoiceRecord['status']) => {
    if (status === 'paid') return <span className="badge badge-green">Lunas</span>;
    if (status === 'invoiced') return <span className="badge badge-amber">Terkirim</span>;
    return <span className="badge badge-gray">Draft</span>;
  };

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
        {([['laporan', 'Laporan & Invoice'], ['pengaturan', 'Pengaturan Rate']] as const).map(([id, label]) => (
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
            const history = rates[channel] ?? [];
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
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Nilai</label>
                    <NumberInput
                      value={forms[channel].value}
                      onChange={v => setForms(f => ({ ...f, [channel]: { ...f[channel], value: v } }))}
                      placeholder={forms[channel].type === 'percent' ? 'cth. 3' : 'cth. 2000'}
                      style={{ width: 160, height: FORM_CTRL_H, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Efektif Sejak</label>
                    <input type="date" value={forms[channel].effectiveFrom} max={todayIso}
                      onChange={e => setForms(f => ({ ...f, [channel]: { ...f[channel], effectiveFrom: e.target.value } }))}
                      className="input" style={{ width: 150, height: FORM_CTRL_H, boxSizing: 'border-box' }} />
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
                        {history.slice().sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)).map(r => (
                          <div key={r.id} className="px-4 py-2.5 flex items-center justify-between text-xs" style={{ borderTop: '1px solid var(--border-2)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Efektif {fmtDate(r.effectiveFrom)}</span>
                            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{r.type === 'percent' ? `${r.value}%` : formatRp(r.value)}</span>
                            <span style={{ color: 'var(--text-muted)' }}>oleh {r.createdBy}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {subTab === 'laporan' && (
        <div className="space-y-4">
          <div className="card p-4 flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Dari</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" style={{ width: 160, height: FORM_CTRL_H, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Sampai</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input" style={{ width: 160, height: FORM_CTRL_H, boxSizing: 'border-box' }} />
            </div>
            <button onClick={loadReport} disabled={loadingReport} className="btn-ghost px-4 text-xs flex items-center gap-1.5" style={{ height: FORM_CTRL_H }}>
              {loadingReport ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Tampilkan
            </button>
            <div className="flex-1" />
            <button onClick={generateInvoice} disabled={generating || !report || report.totalFee <= 0} className="btn-primary px-4 text-xs flex items-center gap-1.5" style={{ height: FORM_CTRL_H }}>
              {generating ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Buat Invoice
            </button>
          </div>

          {report && (
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
                    <tr style={{ borderTop: '2px solid var(--accent)', background: 'var(--accent-bg)' }}>
                      <td className="px-4 py-3 font-extrabold" style={{ color: 'var(--text-primary)' }} colSpan={4}>TOTAL BIAYA ADMIN</td>
                      <td className="px-4 py-3 text-right tabular font-extrabold" style={{ color: 'var(--accent)' }}>{formatRp(report.totalFee)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
              <Receipt size={15} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Riwayat Invoice</p>
            </div>
            {invoices.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                {loadingInvoices ? 'Memuat…' : 'Belum ada invoice dibuat.'}
              </p>
            ) : (
              <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
                {invoices.map(inv => (
                  <div key={inv.id} className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{inv.invoiceNo}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{inv.periodFrom} – {inv.periodTo}</p>
                    </div>
                    {statusBadge(inv.status)}
                    <span className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(inv.totalFee)}</span>
                    <button onClick={() => downloadInvoicePdf(inv)} className="btn-ghost h-8 px-3 text-xs flex items-center gap-1.5">
                      <FileDown size={13} /> PDF
                    </button>
                    {inv.status !== 'paid' && (
                      <button onClick={() => markPaid(inv)} className="btn-ghost h-8 px-3 text-xs flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
                        <CheckCircle2 size={13} /> Tandai Lunas
                      </button>
                    )}
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
    </div>
  );
}
