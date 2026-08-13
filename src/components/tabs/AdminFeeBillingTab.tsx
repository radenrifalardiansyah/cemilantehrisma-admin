'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Receipt, FileDown, CheckCircle2, ListChecks, X, Landmark, History, Building2 } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import TopbarPortal from '@/components/TopbarPortal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import AdminFeeInvoicePDF, { type AdminFeeInvoiceData, type AdminFeePaymentInfo } from '@/lib/pdf/AdminFeeInvoicePDF';

type Channel = 'online' | 'kasir' | 'consignment';
type FeeType = 'percent' | 'fixed';

interface TxnDetail {
  id: string; label: string; createdAt: { seconds: number } | null;
  revenue: number; feeAmount: number; invoiceId: string | null; invoiceNo: string | null;
}
interface ChannelBreakdown {
  channel: Channel; label: string; revenue: number; transactionCount: number; feeAmount: number;
  currentRate: { type: FeeType; value: number } | null;
  transactions: TxnDetail[];
}
interface InvoiceRecord {
  id: string; invoiceNo: string; periodFrom: string; periodTo: string;
  breakdown: ChannelBreakdown[]; totalRevenue: number; totalFee: number;
  status: 'draft' | 'invoiced' | 'paid';
  createdAt: { seconds: number } | null;
  paidAt: { seconds: number } | null; paidBy: string | null;
  note: string | null; dueDate: string | null;
}

const formatRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

const rateLabel = (rate: { type: FeeType; value: number } | null) => {
  if (!rate) return '–';
  return rate.type === 'percent' ? `${rate.value}%` : formatRp(rate.value);
};

const fmtDate = (ts: { seconds: number } | null) =>
  ts ? new Date(ts.seconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';

const fmtDateTime = (ts: { seconds: number } | null) =>
  ts ? new Date(ts.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';

export default function AdminFeeBillingTab({ creds }: { creds: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceRecord | null>(null);
  const [txnModalChannel, setTxnModalChannel] = useState<Channel | null>(null);
  const [clientName, setClientName] = useState('Cemilan Teh Risma');
  const [paymentInfo, setPaymentInfo] = useState<AdminFeePaymentInfo | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetch('/api/settings', { headers }).then(async r => {
      if (r.ok) {
        const { settings } = await r.json() as { settings?: { storeName?: string } };
        if (settings?.storeName?.trim()) setClientName(settings.storeName.trim());
      }
    }).catch(() => {});
    fetch('/api/admin-fee/payment-info', { headers }).then(async r => {
      if (r.ok) {
        const d = await r.json() as { paymentInfo?: Partial<AdminFeePaymentInfo> };
        if (d.paymentInfo?.bankName || d.paymentInfo?.accountNumber) {
          setPaymentInfo({ bankName: d.paymentInfo.bankName ?? '', accountNumber: d.paymentInfo.accountNumber ?? '', accountHolder: d.paymentInfo.accountHolder ?? '' });
        }
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin-fee/invoices', { headers });
      if (r.ok) setInvoices((await r.json() as { invoices: InvoiceRecord[] }).invoices);
      else toast.error('Gagal memuat tagihan biaya admin.');
    } catch { toast.error('Gagal memuat tagihan biaya admin.'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const downloadInvoicePdf = async (inv: InvoiceRecord) => {
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

  const payInvoice = async (inv: InvoiceRecord) => {
    const ok = await confirm({
      title: 'Bayar Tagihan',
      message: `Tandai tagihan ${inv.invoiceNo} sebesar ${formatRp(inv.totalFee)} sebagai sudah dibayar? Pastikan pembayaran sudah benar-benar dilakukan ke RMedia Solutions.`,
      confirmLabel: 'Sudah Saya Bayar',
    });
    if (!ok) return;
    setPayingId(inv.id);
    try {
      const r = await fetch(`/api/admin-fee/invoices/${inv.id}/pay`, { method: 'POST', headers, body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { toast.success('Tagihan ditandai sudah dibayar.'); loadInvoices(); }
      else toast.error(d.error ?? 'Gagal menandai pembayaran.');
    } catch { toast.error('Gagal menandai pembayaran.'); }
    setPayingId(null);
  };

  const statusBadge = (status: InvoiceRecord['status']) => {
    if (status === 'paid') return <span className="badge badge-green">Lunas</span>;
    return <span className="badge badge-amber">Belum Dibayar</span>;
  };

  const outstanding = invoices.filter(i => i.status === 'invoiced');
  const paid = invoices.filter(i => i.status === 'paid');
  const totalOutstanding = outstanding.reduce((s, i) => s + i.totalFee, 0);

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <TopbarPortal>
        <button onClick={loadInvoices} className="btn-ghost h-9 w-9 p-0 flex items-center justify-center">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </TopbarPortal>

      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          <Landmark size={18} />
        </div>
        <div>
          <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Tagihan Biaya Admin</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tagihan biaya platform dari RMedia Solutions, berdasarkan omzet transaksi Anda.</p>
        </div>
      </div>

      {totalOutstanding > 0 && (
        <div className="card p-4 flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Total belum dibayar ({outstanding.length} tagihan)</p>
            <p className="text-lg font-extrabold" style={{ color: 'var(--accent)' }}>{formatRp(totalOutstanding)}</p>
          </div>
        </div>
      )}

      {totalOutstanding > 0 && paymentInfo && (paymentInfo.bankName || paymentInfo.accountNumber) && (
        <div className="card p-4 flex items-center gap-3 flex-wrap" style={{ border: '1px solid var(--success)' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
            <Building2 size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-muted)' }}>Transfer Biaya Admin ke</p>
            <p className="text-sm font-extrabold tabular" style={{ color: 'var(--text-primary)' }}>
              {paymentInfo.bankName} — {paymentInfo.accountNumber} <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>a.n. {paymentInfo.accountHolder}</span>
            </p>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
          <Receipt size={15} style={{ color: 'var(--accent)' }} />
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tagihan Aktif</p>
        </div>
        {outstanding.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            {loading ? 'Memuat…' : 'Tidak ada tagihan yang belum dibayar.'}
          </p>
        ) : (
          <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
            {outstanding.map(inv => (
              <div key={inv.id} className="px-5 py-3.5 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{inv.invoiceNo}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{inv.periodFrom} – {inv.periodTo}</p>
                    {inv.dueDate && (
                      <p className="text-xs mt-0.5 font-semibold" style={{ color: inv.dueDate < todayIso ? 'var(--danger)' : 'var(--text-muted)' }}>
                        Jatuh tempo {fmtDate({ seconds: new Date(inv.dueDate).getTime() / 1000 })}
                        {inv.dueDate < todayIso ? ' — Terlambat, segera bayar' : ''}
                      </p>
                    )}
                  </div>
                  {statusBadge(inv.status)}
                  <span className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(inv.totalFee)}</span>
                  <button onClick={() => setDetail(inv)} className="btn-ghost h-8 px-3 text-xs flex items-center gap-1.5">
                    <ListChecks size={13} /> Detail
                  </button>
                  <button onClick={() => downloadInvoicePdf(inv)} className="btn-ghost h-8 px-3 text-xs flex items-center gap-1.5">
                    <FileDown size={13} /> PDF
                  </button>
                  <button onClick={() => payInvoice(inv)} disabled={payingId === inv.id} className="btn-primary h-8 px-3 text-xs flex items-center gap-1.5">
                    {payingId === inv.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Bayar
                  </button>
                </div>
                {inv.note && (
                  <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--accent-bg)', color: 'var(--text-secondary)', borderLeft: '3px solid var(--accent)' }}>
                    <span className="font-bold" style={{ color: 'var(--accent)' }}>Catatan dari RMedia Solutions: </span>{inv.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-2)' }}>
          <History size={15} style={{ color: 'var(--accent)' }} />
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Riwayat Pembayaran</p>
        </div>
        {paid.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            {loading ? 'Memuat…' : 'Belum ada pembayaran.'}
          </p>
        ) : (
          <div className="divide-y divide-[var(--border-2)]" style={{ borderColor: 'var(--border-2)' }}>
            {paid.map(inv => (
              <div key={inv.id} className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{inv.invoiceNo}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{inv.periodFrom} – {inv.periodTo}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Dibayar {fmtDateTime(inv.paidAt)}{inv.paidBy ? ` oleh ${inv.paidBy}` : ''}</p>
                  {inv.note && (
                    <p className="text-xs mt-0.5 italic truncate" style={{ color: 'var(--text-muted)' }} title={inv.note}>“{inv.note}”</p>
                  )}
                </div>
                {statusBadge(inv.status)}
                <span className="text-sm font-extrabold tabular" style={{ color: 'var(--accent)' }}>{formatRp(inv.totalFee)}</span>
                <button onClick={() => setDetail(inv)} className="btn-ghost h-8 px-3 text-xs flex items-center gap-1.5">
                  <ListChecks size={13} /> Detail
                </button>
                <button onClick={() => downloadInvoicePdf(inv)} className="btn-ghost h-8 px-3 text-xs flex items-center gap-1.5">
                  <FileDown size={13} /> PDF
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal-sheet modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-accent" />
            <span className="modal-handle" />
            <div className="modal-header">
              <div className="modal-header-left">
                <div className="modal-icon"><Receipt size={17} /></div>
                <div>
                  <p className="modal-title">{detail.invoiceNo}</p>
                  <p className="modal-subtitle">{detail.periodFrom} – {detail.periodTo}</p>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="modal-close"><X size={14} /></button>
            </div>
            <div className="modal-body">
              {detail.status === 'invoiced' && detail.dueDate && (
                <p className="text-xs mb-2 font-semibold" style={{ color: detail.dueDate < todayIso ? 'var(--danger)' : 'var(--text-muted)' }}>
                  Jatuh tempo {fmtDate({ seconds: new Date(detail.dueDate).getTime() / 1000 })}
                  {detail.dueDate < todayIso ? ' — Terlambat, segera bayar' : ''}
                </p>
              )}
              {detail.status === 'invoiced' && paymentInfo && (paymentInfo.bankName || paymentInfo.accountNumber) && (
                <div className="rounded-lg px-3 py-2 text-xs mb-3" style={{ background: 'var(--success-bg)', color: 'var(--text-secondary)', borderLeft: '3px solid var(--success)' }}>
                  <span className="font-bold" style={{ color: 'var(--success)' }}>Transfer ke: </span>
                  {paymentInfo.bankName} — {paymentInfo.accountNumber} a.n. {paymentInfo.accountHolder}
                </div>
              )}
              {detail.note && (
                <div className="rounded-lg px-3 py-2 text-xs mb-4" style={{ background: 'var(--accent-bg)', color: 'var(--text-secondary)', borderLeft: '3px solid var(--accent)' }}>
                  <span className="font-bold" style={{ color: 'var(--accent)' }}>Catatan dari RMedia Solutions: </span>{detail.note}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th className="text-left px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Channel</th>
                      <th className="text-right px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Omzet</th>
                      <th className="text-center px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Transaksi</th>
                      <th className="text-right px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Rate</th>
                      <th className="text-right px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Biaya Admin</th>
                      <th className="text-center px-4 py-3 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Rincian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.breakdown.map(b => (
                      <tr key={b.channel} style={{ borderTop: '1px solid var(--border-2)' }}>
                        <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>{b.label}</td>
                        <td className="px-4 py-3 text-right tabular" style={{ color: 'var(--text-primary)' }}>{formatRp(b.revenue)}</td>
                        <td className="px-4 py-3 text-center tabular" style={{ color: 'var(--text-muted)' }}>{b.transactionCount}</td>
                        <td className="px-4 py-3 text-right tabular" style={{ color: 'var(--text-muted)' }}>{rateLabel(b.currentRate)}</td>
                        <td className="px-4 py-3 text-right tabular font-bold" style={{ color: 'var(--accent)' }}>{formatRp(b.feeAmount)}</td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => setTxnModalChannel(b.channel)} disabled={b.transactionCount === 0}
                            className="btn-ghost h-7 px-2.5 text-xs flex items-center gap-1.5 mx-auto" style={{ opacity: b.transactionCount === 0 ? 0.4 : 1 }}>
                            <ListChecks size={12} /> Lihat
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--accent)', background: 'var(--accent-bg)' }}>
                      <td className="px-4 py-3 font-extrabold" style={{ color: 'var(--text-primary)' }} colSpan={4}>TOTAL BIAYA ADMIN</td>
                      <td className="px-4 py-3 text-right tabular font-extrabold" style={{ color: 'var(--accent)' }}>{formatRp(detail.totalFee)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {txnModalChannel && detail && (() => {
        const b = detail.breakdown.find(x => x.channel === txnModalChannel);
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
                    <p className="modal-subtitle">{detail.periodFrom} – {detail.periodTo} · {b.transactionCount} transaksi</p>
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
