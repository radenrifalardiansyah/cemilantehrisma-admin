'use client';

import { PERIOD_OPTIONS, type PeriodKey } from '@/lib/period';

// Tombol periode (Hari Ini, 7 Hari, 30 Hari, Bulan Ini, Tahun Ini, Custom) — gaya yang sama dengan
// filter periode di Mitra. Mode Custom menampilkan pemilih tanggal dari–sampai.
export default function PeriodBar({ period, onPeriod, from, to, onFrom, onTo }: {
  period: PeriodKey; onPeriod: (p: PeriodKey) => void;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIOD_OPTIONS.map(p => (
        <button key={p.id} onClick={() => onPeriod(p.id)} className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
          style={period === p.id ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
          {p.label}
        </button>
      ))}
      {period === 'custom' && (
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input type="date" value={from} onChange={e => onFrom(e.target.value)} className="input flex-1 min-w-0 sm:flex-none" style={{ height: 36 }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>s/d</span>
          <input type="date" value={to} onChange={e => onTo(e.target.value)} className="input flex-1 min-w-0 sm:flex-none" style={{ height: 36 }} />
        </div>
      )}
    </div>
  );
}
