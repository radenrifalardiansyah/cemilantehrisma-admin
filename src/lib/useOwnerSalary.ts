'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Gaji pemilik per bulan (Laporan Keuangan) — disimpan di server (/api/finance/owner-salary), sama di semua perangkat.
export function useOwnerSalary(creds: string) {
  const [raw, setRaw] = useState('0');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/finance/owner-salary', { headers: { 'x-admin-auth': creds } })
      .then(async r => { if (r.ok && !cancelled) setRaw(String((await r.json() as { value: number }).value ?? 0)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [creds]);

  const update = useCallback((next: string) => {
    setRaw(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/finance/owner-salary', {
        method: 'PUT', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: Math.max(0, parseFloat(next) || 0) }),
      }).catch(() => {});
    }, 600);
  }, [creds]);

  return { raw, monthly: Math.max(0, parseFloat(raw) || 0), update };
}
