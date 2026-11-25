'use client';

import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { MAX_PINS, effectivePins, isPinnable, readCachedPins, resolvePins, samePins, togglePin, writeCachedPins } from '@/lib/pins';

const SAVE_TIMEOUT_MS = 15_000;

// Menu yang disematkan ke tampilan depan Desktop (per pengguna, disimpan di server). `pins` = pilihan eksplisit (null = belum pernah memilih -> bawaan);
// `effective` = yang dipakai tampilan. toggle(): optimistis (langsung tampil), PUT; gagal -> toast dan kembali ke nilai terkonfirmasi; sukses usang
// (sudah ada perubahan lebih baru) tidak menimpa nilai terkonfirmasi maupun cache. Pertama kali toggle, daftar eksplisit dimulai dari bawaan.
export function usePins(creds: string) {
  const toast = useToast();
  const [pins, setPins] = useState<string[] | null>(null);
  const confirmed = useRef<string[] | null>(null);
  const current = useRef<string[] | null>(null);
  const username = useRef('');
  const seq = useRef(0);
  const confirmedSeq = useRef(0);   // nomor PUT terbaru yang sudah terkonfirmasi server

  const hydrate = useCallback((name: string, server: unknown) => {
    const next = resolvePins(server, readCachedPins(name));
    username.current = name;
    confirmed.current = next;
    current.current = next;
    writeCachedPins(name, next);
    setPins(next);
  }, []);

  const persist = useCallback(async (next: string[] | null) => {
    const mine = ++seq.current;
    current.current = next;
    setPins(next);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SAVE_TIMEOUT_MS);
    try {
      const res = await fetch('/api/me/pins', {
        method: 'PUT',
        headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins: next }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`/api/me/pins ${res.status}`);
      // Sukses usang tetap dihitung sebagai keadaan server selama LEBIH BARU dari yang terkonfirmasi terakhir (jadi bila PUT berikutnya gagal,
      // rollback kembali ke keadaan server yang benar, bukan ke keadaan sebelum PUT ini). Sukses yang lebih tua dari yang terkonfirmasi diabaikan.
      if (mine > confirmedSeq.current) {
        confirmedSeq.current = mine;
        confirmed.current = next;
        writeCachedPins(username.current, next);
      }
    } catch (err) {
      console.error('Gagal menyimpan menu yang disematkan', err);
      if (mine === seq.current) {
        current.current = confirmed.current;
        setPins(confirmed.current);
        toast.error('Gagal menyimpan menu yang disematkan. Dikembalikan ke pengaturan sebelumnya.');
      }
    } finally {
      clearTimeout(timer);
    }
  }, [creds, toast]);

  const toggle = useCallback((tab: string) => {
    if (!isPinnable(tab)) return;
    const base = current.current;
    const next = togglePin(base, tab);
    if (next.length > MAX_PINS) { toast.error(`Maksimum ${MAX_PINS} menu yang bisa disematkan.`); return; }
    if (samePins(next, base)) return;
    void persist(next);
  }, [persist, toast]);

  const reset = useCallback(() => { void persist(null); }, [persist]);

  return { pins, effective: effectivePins(pins), toggle, reset, hydrate };
}
