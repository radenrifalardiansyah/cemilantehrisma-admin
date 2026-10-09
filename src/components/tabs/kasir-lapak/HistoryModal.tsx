'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, Undo2, Printer } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';
import { ModalShell, Badge, Field, ErrorBox, rupiah } from '../titip-jual/shared';
import { PAY_LABEL, type PosStall, type Sale } from './types';

const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

async function fetchSales(creds: string, stallId: string, date: string): Promise<Sale[]> {
  const r = await fetch(`/api/stall-pos/sales?stallId=${stallId}&from=${date}&to=${date}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? ((await r.json()) as { sales: Sale[] }).sales : [];
}

// Riwayat penjualan lapak per hari + batalkan penjualan (selama shift-nya masih terbuka) + cetak ulang struk.
export default function HistoryModal({ creds, stall, canVoid, onClose, onChanged, onPrint }: {
  creds: string; stall: PosStall; canVoid: boolean; onClose: () => void; onChanged: () => void; onPrint: (s: Sale) => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => { setSales(await fetchSales(creds, stall.id, date)); }, [creds, stall.id, date]);
  useEffect(() => {
    let alive = true;
    fetchSales(creds, stall.id, date).then(d => { if (alive) setSales(d); });
    return () => { alive = false; };
  }, [creds, stall.id, date]);

  const doVoid = async () => {
    if (!voiding) return;
    setBusy(true); setError('');
    const r = await fetch(`/api/stall-pos/sales/${voiding.id}/void`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    if (r.ok) {
      toast.success(`${voiding.invoiceNo} dibatalkan.`);
      setVoiding(null); setReason('');
      await load(); onChanged();
    } else {
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal membatalkan.';
      setError(msg); toast.error(msg);
    }
    setBusy(false);
  };

  const paid = (sales ?? []).filter(s => s.status === 'paid');
  const total = paid.reduce((a, s) => a + s.total, 0);

  return (
    <>
      <ModalShell title="Riwayat Penjualan" subtitle={stall.name} icon={<History size={17} />} onClose={onClose} size="modal-md"
        footer={<button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" className="input" style={{ height: 36, width: 'auto' }} value={date} onChange={e => setDate(e.target.value)} />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{paid.length} transaksi · <b style={{ color: 'var(--text-primary)' }}>{rupiah(total)}</b></p>
          </div>
          {sales === null ? <PageLoader /> : sales.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Belum ada penjualan pada tanggal ini.</p>
          ) : (
            <div>
              {sales.map((s, idx) => (
                <div key={s.id} className="py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, opacity: s.status === 'void' ? 0.6 : 1 }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{s.invoiceNo}</p>
                        <Badge tone={s.status === 'void' ? 'danger' : 'ok'}>{s.status === 'void' ? 'Batal' : PAY_LABEL[s.paymentMethod]}</Badge>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {s.createdAt ? new Date(s.createdAt.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''} · {s.cashier}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{s.items.map(i => `${i.name} ×${i.qty}`).join(', ')}</p>
                      {s.status === 'void' && <p className="text-[11px]" style={{ color: 'var(--danger)' }}>Dibatalkan: {s.voidReason}</p>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <p className="text-sm font-bold mr-1" style={{ color: 'var(--text-primary)', textDecoration: s.status === 'void' ? 'line-through' : undefined }}>{rupiah(s.total)}</p>
                      <Tooltip label="Cetak struk"><button onClick={() => onPrint(s)} className="btn-ghost p-2"><Printer size={13} /></button></Tooltip>
                      {canVoid && s.status === 'paid' && (
                        <Tooltip label="Batalkan penjualan">
                          <button onClick={() => { setVoiding(s); setReason(''); setError(''); }} className="btn-ghost p-2" style={{ color: 'var(--danger)' }}><Undo2 size={13} /></button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ModalShell>

      {voiding && (
        <ModalShell title="Batalkan Penjualan" subtitle={voiding.invoiceNo} icon={<Undo2 size={17} />} onClose={() => setVoiding(null)}
          footer={(
            <>
              <button onClick={() => setVoiding(null)} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Kembali</button>
              <button onClick={doVoid} disabled={busy || !reason.trim()} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0', background: 'var(--danger)' }}>
                {busy ? 'Memproses…' : 'Batalkan Penjualan'}
              </button>
            </>
          )}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Stok barang dikembalikan dan uang {rupiah(voiding.total)} dikeluarkan dari dompet lapak. Hanya bisa selama shift masih terbuka.
            </p>
            <Field label="Alasan pembatalan" required>
              <input className="input" value={reason} maxLength={200} autoFocus onChange={e => setReason(e.target.value)} placeholder="cth: salah input barang" />
            </Field>
            <ErrorBox message={error} />
          </div>
        </ModalShell>
      )}
    </>
  );
}
