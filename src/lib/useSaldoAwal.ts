'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SALDO_AWAL_KEY } from '@/lib/finance';

// Saldo Awal disimpan di server (/api/finance/saldo-awal) supaya sama di semua perangkat. Nilai
// lama di localStorage (versi sebelumnya) dimigrasi otomatis sekali kalau server belum punya nilai.
export function useSaldoAwal(creds: string) {
  const [raw, setRaw] = useState('0');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/finance/saldo-awal', { headers: { 'x-admin-auth': creds } });
        if (!res.ok) throw new Error();
        const { value } = await res.json() as { value: number | null };
        if (cancelled) return;
        if (value !== null) { setRaw(String(value)); return; }
        const legacy = localStorage.getItem(SALDO_AWAL_KEY);
        if (legacy && (parseFloat(legacy) || 0) !== 0) {
          setRaw(legacy);
          fetch('/api/finance/saldo-awal', {
            method: 'PUT', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: parseFloat(legacy) || 0 }),
          }).catch(() => {});
        }
      } catch {
        try { const legacy = localStorage.getItem(SALDO_AWAL_KEY); if (legacy && !cancelled) setRaw(legacy); } catch { /* abaikan */ }
      }
    })();
    return () => { cancelled = true; };
  }, [creds]);

  const update = useCallback((next: string) => {
    setRaw(next);
    try { localStorage.setItem(SALDO_AWAL_KEY, next); } catch { /* abaikan */ }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/finance/saldo-awal', {
        method: 'PUT', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: parseFloat(next) || 0 }),
      }).catch(() => {});
    }, 600);
  }, [creds]);

  return { raw, saldoAwal: parseFloat(raw) || 0, update };
}
