'use client';

import NumberInput from '@/components/NumberInput';
import { formatRp } from '@/lib/format';
import { closingPeriodLabel } from '@/lib/closing-settlement-core';

export interface PayableClosing {
  id: string; periodFrom: string | null; periodTo: string; totalCogs: number; remaining: number; mine: number;
}

// Total yang dialokasikan (nominal tautan terisi untuk closing yang dicentang).
export const selectedTotal = (sel: Record<string, string>) => Object.values(sel).reduce((n, v) => n + (parseFloat(v) || 0), 0);

// Pesan masalah alokasi di sisi klien (server memvalidasi ulang secara definitif).
export function closingLinksProblem(closings: PayableClosing[], sel: Record<string, string>, transferAmount: number): string {
  for (const c of closings) {
    if (!(c.id in sel)) continue;
    const v = parseFloat(sel[c.id]) || 0;
    if (v <= 0) return `Isi nominal tautan untuk closing ${closingPeriodLabel(c.periodFrom, c.periodTo)}.`;
    if (v > c.remaining + 0.005) return `Nominal tautan closing ${closingPeriodLabel(c.periodFrom, c.periodTo)} melebihi sisa HPP (${formatRp(c.remaining)}).`;
  }
  const total = selectedTotal(sel);
  if (total > transferAmount + 0.005) return `Total tautan closing (${formatRp(total)}) melebihi jumlah transfer (${formatRp(transferAmount)}).`;
  return '';
}

// Bagian "Untuk closing (opsional)" pada form Transfer Antar Dompet: pilih closing aktif yang belum lunas ditransfer
// dan nominal tautannya (default = min(sisa closing, sisa transfer yang belum teralokasi)). Tidak mengubah saldo.
export default function TransferClosingPicker({ closings, selected, onChange, transferAmount, onSuggestAmount }: {
  closings: PayableClosing[]; selected: Record<string, string>; onChange: (next: Record<string, string>) => void;
  transferAmount: number; onSuggestAmount: (n: number) => void;
}) {
  const allocated = selectedTotal(selected);
  const toggle = (c: PayableClosing) => {
    const next = { ...selected };
    if (c.id in next) { delete next[c.id]; onChange(next); return; }
    // Jumlah transfer masih kosong: sarankan sebesar sisa HPP closing (kasus umum: transfer = HPP closing).
    const base = transferAmount > 0 ? transferAmount : Math.round(c.remaining);
    if (transferAmount <= 0) onSuggestAmount(base);
    const free = Math.max(0, base - allocated);
    next[c.id] = String(Math.max(0, Math.floor(Math.min(c.remaining, free))));
    onChange(next);
  };
  return (
    <div>
      <p className="field-label">Untuk closing (opsional)</p>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-2)' }}>
        {closings.map((c, i) => {
          const on = c.id in selected;
          return (
            <div key={c.id} className="px-3 py-2.5" style={{ borderTop: i > 0 ? '1px solid var(--border-2)' : undefined, background: on ? 'var(--accent-bg)' : undefined }}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => toggle(c)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Closing {closingPeriodLabel(c.periodFrom, c.periodTo)}</span>
                  <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>HPP {formatRp(c.totalCogs)} · sisa {formatRp(c.remaining)}</span>
                </span>
              </label>
              {on && (
                <div className="mt-2 pl-6">
                  <NumberInput value={selected[c.id]} onChange={raw => onChange({ ...selected, [c.id]: raw })} placeholder="Nominal tautan" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {Object.keys(selected).length > 0 && (
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          Teralokasi {formatRp(allocated)}{transferAmount > 0 ? ` · belum teralokasi ${formatRp(Math.max(0, transferAmount - allocated))}` : ''}
        </p>
      )}
    </div>
  );
}
