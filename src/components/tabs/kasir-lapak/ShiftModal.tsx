'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import NumberInput from '@/components/NumberInput';
import { useToast } from '@/components/Toast';
import { ModalShell, ModalFooter, Field, ErrorBox, rupiah } from '../titip-jual/shared';
import type { PosStall, Shift } from './types';

// Buka / tutup shift kasir lapak.
export default function ShiftModal({ creds, stall, mode, onClose, onDone }: {
  creds: string; stall: PosStall; mode: 'open' | 'close'; onClose: () => void; onDone: (shift: Shift | null) => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };

  const submit = async () => {
    setSaving(true); setError('');
    const r = mode === 'open'
      ? await fetch('/api/stall-pos/shifts', { method: 'POST', headers, body: JSON.stringify({ stallId: stall.id, openingBalance: Number(amount || 0), note }) })
      : await fetch(`/api/stall-pos/shifts/${stall.shift!.id}`, { method: 'PUT', headers, body: JSON.stringify({ actualBalance: Number(amount || 0), note }) });
    const d = await r.json().catch(() => ({})) as { shift?: Shift; error?: string };
    if (r.ok && d.shift) {
      if (mode === 'open') toast.success('Kasir lapak dibuka.');
      else {
        const diff = d.shift.difference ?? 0;
        toast.success(diff === 0 ? 'Kasir ditutup. Kas sesuai.' : `Kasir ditutup. Selisih kas: ${diff > 0 ? '+' : '-'}${rupiah(Math.abs(diff))}`);
      }
      onDone(mode === 'open' ? d.shift : null);
    } else {
      const msg = d.error ?? 'Gagal memproses shift.';
      setError(msg); toast.error(msg);
    }
    setSaving(false);
  };

  return (
    <ModalShell title={mode === 'open' ? 'Buka Kasir' : 'Tutup Kasir'} subtitle={stall.name} icon={<Clock size={17} />} onClose={onClose}
      footer={<ModalFooter onClose={onClose} onSave={submit} saving={saving} label={mode === 'open' ? 'Buka Kasir' : 'Tutup Kasir'} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label={mode === 'open' ? 'Kas awal di laci (Rp)' : 'Uang tunai di laci saat ini (Rp)'}>
          <NumberInput value={amount} placeholder="0" autoFocus onChange={setAmount} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {mode === 'open' ? 'Uang tunai yang ada di laci saat mulai berjualan.' : 'Hitung uang tunai fisik. Sistem membandingkannya dengan kas awal + penjualan tunai.'}
          </p>
        </Field>
        <Field label="Catatan (opsional)">
          <input className="input" value={note} maxLength={200} onChange={e => setNote(e.target.value)} />
        </Field>
        <ErrorBox message={error} />
      </div>
    </ModalShell>
  );
}
