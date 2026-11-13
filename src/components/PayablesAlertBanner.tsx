'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { formatRp } from '@/lib/format';
import { ALERT_DAYS, type PayablesSummary } from '@/lib/payables-core';

// Banner peringatan hutang supplier: tampil bila ada hutang yang lewat jatuh tempo atau jatuh tempo <= H-3.
// Hanya untuk pemegang izin 'materials' 'view' (`canView`): tanpa izin tidak memanggil API sama sekali.
// Gagal memuat = banner tidak tampil (peringatan tambahan, bukan bagian utama halaman).
export default function PayablesAlertBanner({ creds, canView, reloadKey = 0, onOpen }: {
  creds: string; canView: boolean; reloadKey?: number; onOpen: () => void;
}) {
  const [summary, setSummary] = useState<PayablesSummary | null>(null);

  useEffect(() => {
    if (!canView) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    fetch('/api/material-purchases/payables?summary=1', { headers: { 'x-admin-auth': creds }, signal: ctrl.signal })
      .then(r => r.ok ? r.json() as Promise<{ summary: PayablesSummary }> : null)
      .then(d => { if (d) setSummary(d.summary); })
      .catch(err => { if (!ctrl.signal.aborted) console.error('Gagal memuat peringatan hutang supplier', err); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [creds, canView, reloadKey]);

  if (!canView || !summary || summary.alertCount === 0) return null;
  const danger = summary.overdueCount > 0;
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left"
      style={{ background: danger ? 'var(--danger-bg)' : 'var(--accent-bg)', border: `1px solid ${danger ? 'var(--danger-border)' : 'var(--accent-border)'}` }}>
      <AlertTriangle size={16} className="flex-shrink-0" style={{ color: danger ? 'var(--danger)' : 'var(--warning)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
          Hutang supplier {danger ? 'lewat jatuh tempo' : `jatuh tempo ≤ ${ALERT_DAYS} hari`}: {formatRp(summary.alertAmount)}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {summary.alertSupplierCount} supplier · {summary.alertCount} pembelian
          {danger ? ` (${summary.overdueCount} sudah lewat)` : ''}
        </p>
      </div>
      <span className="text-xs font-bold flex-shrink-0 inline-flex items-center gap-0.5" style={{ color: 'var(--accent)' }}>Lihat rekap <ChevronRight size={13} /></span>
    </button>
  );
}
