'use client';

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { computeReturn, remainingQty } from '@/lib/stall-return';
import { ModalShell, ModalFooter, Field, ErrorBox, rupiah, qtyText } from '../titip-jual/shared';
import type { Sale } from './types';

// Retur SEBAGIAN: pelanggan mengembalikan sebagian barang. Stok kembali, uang dikembalikan sebesar nilai
// barang dikurangi bagian diskon proporsional, dan bagi hasil penitip dikoreksi otomatis.
export default function ReturnModal({ creds, sale, onClose, onDone }: {
  creds: string; sale: Sale; onClose: () => void; onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selections = Object.entries(qtys).map(([i, v]) => ({ index: Number(i), qty: Number(v) })).filter(s => s.qty > 0);
  const calc = selections.length > 0 ? computeReturn(sale.items, sale.subtotal, sale.discount, selections) : null;
  const refund = calc && 'refund' in calc ? calc.refund : 0;
  const calcError = calc && 'error' in calc ? calc.error : '';
  const refundLeft = sale.total - sale.refundTotal;

  const save = async () => {
    setSaving(true); setError('');
    const r = await fetch(`/api/stall-pos/sales/${sale.id}/return`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, items: selections }),
    });
    const d = await r.json().catch(() => ({})) as { docNumber?: string; refund?: number; error?: string };
    if (r.ok && d.docNumber) { toast.success(`Retur dicatat (${d.docNumber}). Kembalikan ${rupiah(d.refund ?? 0)} ke pelanggan.`); await onDone(); }
    else { const msg = d.error ?? 'Gagal mencatat retur.'; setError(msg); toast.error(msg); }
    setSaving(false);
  };

  return (
    <ModalShell title="Retur Sebagian" subtitle={sale.invoiceNo} icon={<RotateCcw size={17} />} onClose={onClose}
      footer={<ModalFooter onClose={onClose} onSave={save} saving={saving} disabled={!calc || !!calcError || !reason.trim()} label="Catat Retur" />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          Isi jumlah barang yang dikembalikan pelanggan. Stok barang itu kembali, uang dikembalikan, dan bagi hasil penitip dikoreksi. Hanya bisa selama shift masih terbuka.
        </p>
        <div>
          {sale.items.map((it, idx) => {
            const left = remainingQty(it);
            return (
              <div key={idx} className="flex items-center gap-2 py-2.5" style={{ borderTop: idx > 0 ? '1px solid var(--border-2)' : undefined, opacity: left <= 0 ? 0.5 : 1 }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{it.name}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {rupiah(it.price)} × {qtyText(it.qty)}{(it.returnedQty ?? 0) > 0 ? ` · sudah diretur ${qtyText(it.returnedQty!)}` : ''}
                  </p>
                </div>
                <input className="input" style={{ width: 80, flexShrink: 0 }} type="number" min={0} max={left} step="any" inputMode="decimal" placeholder="0" disabled={left <= 0}
                  value={qtys[idx] ?? ''} onChange={e => setQtys(q => ({ ...q, [idx]: e.target.value }))} />
                <span className="text-[11px] w-10 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>/ {qtyText(left)}</span>
              </div>
            );
          })}
        </div>
        <Field label="Alasan retur" required>
          <input className="input" value={reason} maxLength={200} placeholder="cth: kemasan rusak, salah beli" onChange={e => setReason(e.target.value)} />
        </Field>
        {calc && !calcError && (
          <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--accent-bg)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Dikembalikan ke pelanggan</span>
            <span className="text-lg font-extrabold tabular" style={{ color: 'var(--accent)' }}>{rupiah(refund)}</span>
          </div>
        )}
        {sale.discount > 0 && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Diskon transaksi ({rupiah(sale.discount)}) dikembalikan proporsional. Sisa nilai bersih transaksi: {rupiah(refundLeft)}.</p>}
        <ErrorBox message={calcError || error} />
      </div>
    </ModalShell>
  );
}
