'use client';

import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { isUiLayout, readCachedLayout, resolveLayout, writeCachedLayout, type UiLayout } from '@/lib/ui-layout';

const SAVE_TIMEOUT_MS = 15_000;

// Preferensi tata letak pengguna. Server (profiles.ui_layout lewat /api/me) sumber kebenaran; localStorage hanya
// cadangan cepat per username bila server tidak mengembalikan nilai. Mengganti: berlaku langsung (optimistis), lalu
// disimpan; gagal -> toast dan kembali ke nilai terakhir yang terkonfirmasi.
export function useUiLayout(creds: string) {
  const toast = useToast();
  const [layout, setLayout] = useState<UiLayout>('classic');
  const [busy, setBusy] = useState(false);
  const confirmed = useRef<UiLayout>('classic');
  const username = useRef('');
  const seq = useRef(0);

  // Dipanggil saat sesi dimuat (applySession) dengan nilai dari /api/me.
  const hydrate = useCallback((name: string, server: unknown) => {
    const next = resolveLayout(server, readCachedLayout(name));
    username.current = name;
    confirmed.current = next;
    if (isUiLayout(server)) writeCachedLayout(name, server);
    setLayout(next);
  }, []);

  const change = useCallback(async (next: UiLayout) => {
    const mine = ++seq.current;
    setLayout(next);
    setBusy(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SAVE_TIMEOUT_MS);
    try {
      const res = await fetch('/api/me/layout', {
        method: 'PUT',
        headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: next }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`/api/me/layout ${res.status}`);
      // Sukses usang (sudah ada pilihan yang lebih baru) diabaikan: jangan menyentuh nilai terkonfirmasi maupun cache.
      if (mine === seq.current) {
        confirmed.current = next;
        writeCachedLayout(username.current, next);
      }
    } catch (err) {
      console.error('Gagal menyimpan tampilan', err);
      if (mine === seq.current) {
        setLayout(confirmed.current);
        toast.error('Gagal menyimpan tampilan. Dikembalikan ke tampilan sebelumnya.');
      }
    } finally {
      clearTimeout(timer);
      if (mine === seq.current) setBusy(false);
    }
  }, [creds, toast]);

  return { layout, busy, change, hydrate };
}
