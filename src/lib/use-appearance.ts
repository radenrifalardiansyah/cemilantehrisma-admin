'use client';

import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import {
  DEFAULT_APPEARANCE, readCachedAppearance, resolveAppearance, sameAppearance, writeCachedAppearance, writeLastAppearance,
  type Appearance,
} from '@/lib/appearance';

const SAVE_TIMEOUT_MS = 15_000;

// Pengaturan tampilan Desktop. `draft` = yang tampil (pratinjau langsung, belum disimpan); `saved` = yang terkonfirmasi server.
// preview() hanya mengubah draft; save() optimistis (draft jadi saved) lalu PUT, gagal -> toast dan kembali ke saved lama;
// cancel() mengembalikan draft ke saved; reset() mengisi draft dengan default (belum disimpan sampai save()).
export function useAppearance(creds: string) {
  const toast = useToast();
  const [saved, setSaved] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [draft, setDraft] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [busy, setBusy] = useState(false);
  const confirmed = useRef<Appearance>(DEFAULT_APPEARANCE);
  const username = useRef('');
  const seq = useRef(0);

  const hydrate = useCallback((name: string, server: unknown) => {
    const next = resolveAppearance(server, readCachedAppearance(name));
    username.current = name;
    confirmed.current = next;
    if (server && typeof server === 'object') writeCachedAppearance(name, next); else writeLastAppearance(next);
    setSaved(next);
    setDraft(next);
  }, []);

  const preview = useCallback((patch: Partial<Appearance>) => setDraft(d => ({ ...d, ...patch })), []);
  const cancel = useCallback(() => setDraft(confirmed.current), []);
  const reset = useCallback(() => setDraft(DEFAULT_APPEARANCE), []);

  const save = useCallback(async (): Promise<boolean> => {
    const next = draft;
    if (sameAppearance(next, confirmed.current)) return true;
    const mine = ++seq.current;
    const previous = confirmed.current;
    setSaved(next);
    setBusy(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SAVE_TIMEOUT_MS);
    try {
      const res = await fetch('/api/me/appearance', {
        method: 'PUT',
        headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appearance: next }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`/api/me/appearance ${res.status}`);
      // Sukses usang (sudah ada simpan yang lebih baru) diabaikan: jangan menyentuh nilai terkonfirmasi maupun cache.
      if (mine === seq.current) {
        confirmed.current = next;
        writeCachedAppearance(username.current, next);
      }
      return true;
    } catch (err) {
      console.error('Gagal menyimpan pengaturan tampilan', err);
      if (mine === seq.current) {
        setSaved(previous);
        setDraft(previous);
        toast.error('Gagal menyimpan pengaturan tampilan. Dikembalikan ke pengaturan sebelumnya.');
      }
      return false;
    } finally {
      clearTimeout(timer);
      if (mine === seq.current) setBusy(false);
    }
  }, [creds, draft, toast]);

  return { saved, draft, busy, dirty: !sameAppearance(draft, saved), hydrate, preview, cancel, reset, save };
}
