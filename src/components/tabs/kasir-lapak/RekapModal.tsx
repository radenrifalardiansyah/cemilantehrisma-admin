'use client';

import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, FileDown, Loader2 } from 'lucide-react';
import PageLoader from '@/components/PageLoader';
import Tooltip from '@/components/Tooltip';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { ModalShell, Badge, rupiah, qtyText } from '../titip-jual/shared';
import type { Settlement } from '../titip-jual/settlementPdf';
import type { PosStall } from './types';

interface Payable { consignorId: string; consignorName: string; amount: number; qty: number; lines: number; firstDate: string; lastDate: string }
interface Result { payables: Payable[]; settlements: Settlement[] }

async function fetchRekap(creds: string, stallId: string): Promise<Result> {
  const r = await fetch(`/api/stall-pos/rekap?stallId=${stallId}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as Result : { payables: [], settlements: [] };
}

// Rekap penjualan titipan oleh kasir lapak (biasanya siang hari): buat rekap per penitip lalu unduh
// PDF untuk dilaporkan ke owner. Pembayaran ke penitip dilakukan owner (Titip Jual → Rekap & Bayar).
export default function RekapModal({ creds, stall, canCreate, onClose, onPdf }: {
  creds: string; stall: PosStall; canCreate: boolean; onClose: () => void; onPdf: (s: Settlement) => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => { setResult(await fetchRekap(creds, stall.id)); }, [creds, stall.id]);
  useEffect(() => {
    let alive = true;
    fetchRekap(creds, stall.id).then(d => { if (alive) setResult(d); });
    return () => { alive = false; };
  }, [creds, stall.id]);

  const create = async (p: Payable) => {
    if (!await confirm({ message: `Buat rekap untuk ${p.consignorName} sebesar ${rupiah(p.amount)}? Penjualan yang masuk rekap tidak bisa dibatalkan lagi.` })) return;
    setBusy(p.consignorId);
    const r = await fetch('/api/stall-pos/rekap', {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stallId: stall.id, consignorId: p.consignorId }),
    });
    const d = await r.json().catch(() => ({})) as { docNumber?: string; error?: string };
    if (r.ok && d.docNumber) { toast.success(`Rekap ${d.docNumber} dibuat. Unduh PDF-nya untuk dilaporkan ke owner.`); await load(); }
    else toast.error(d.error ?? 'Gagal membuat rekap.');
    setBusy(null);
  };

  const pdf = async (s: Settlement) => {
    setBusy(s.id);
    try { await onPdf(s); } catch { toast.error('Gagal membuat PDF.'); }
    setBusy(null);
  };

  const total = (result?.payables ?? []).reduce((a, p) => a + p.amount, 0);
  const dt = (t: { seconds: number } | null) => t ? new Date(t.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <ModalShell title="Rekap Penjualan Titipan" subtitle={stall.name} icon={<ClipboardList size={17} />} onClose={onClose} size="modal-md"
      footer={<button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Tutup</button>}>
      {result === null ? <PageLoader /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            Buat rekap per penitip, lalu unduh PDF-nya untuk dilaporkan ke owner. Pembayaran ke penitip dilakukan owner.
          </p>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="field-label" style={{ marginBottom: 0 }}>Belum direkap</p>
              {total > 0 && <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Total {rupiah(total)}</p>}
            </div>
            {result.payables.length === 0 ? (
              <p className="text-sm text-center py-5" style={{ color: 'var(--text-muted)' }}>Tidak ada penjualan titipan yang belum direkap.</p>
            ) : result.payables.map((p, idx) => (
              <div key={p.consignorId} className="flex items-center gap-3 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{p.consignorName}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {qtyText(p.qty)} barang terjual · {p.lines} penjualan · {p.firstDate === p.lastDate ? p.firstDate : `${p.firstDate} s/d ${p.lastDate}`}
                  </p>
                </div>
                <p className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>{rupiah(p.amount)}</p>
                {canCreate && (
                  <button onClick={() => create(p)} disabled={busy === p.consignorId} className="btn-primary text-xs flex-shrink-0" style={{ height: 32 }}>
                    {busy === p.consignorId ? <Loader2 size={13} className="animate-spin" /> : 'Buat Rekap'}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div>
            <p className="field-label">Rekap yang sudah dibuat</p>
            {result.settlements.length === 0 ? (
              <p className="text-sm text-center py-5" style={{ color: 'var(--text-muted)' }}>Belum ada rekap.</p>
            ) : result.settlements.map((s, idx) => (
              <div key={s.id} className="flex items-center gap-3 py-3" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{s.docNumber}</p>
                    <Badge tone={s.status === 'paid' ? 'ok' : 'danger'}>{s.status === 'paid' ? 'Sudah dibayar' : 'Belum dibayar'}</Badge>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.consignorName} · {dt(s.createdAt)}{s.createdBy ? ` · ${s.createdBy}` : ''}</p>
                </div>
                <p className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{rupiah(s.totalAmount)}</p>
                <Tooltip label="Unduh PDF untuk owner">
                  <button onClick={() => pdf(s)} disabled={busy === s.id} className="btn-ghost p-2 flex-shrink-0">
                    {busy === s.id ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={14} />}
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
