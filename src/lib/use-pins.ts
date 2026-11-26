'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { MAX_PINS, effectivePins, isPinnable, readCachedPins, resolvePins, samePins, togglePin, writeCachedPins } from '@/lib/pins';

const SAVE_TIMEOUT_MS = 15_000;

// Menu yang disematkan ke tampilan depan Desktop (per pengguna, disimpan di server). `pins` = pilihan eksplisit (null = belum pernah memilih -> bawaan);
// `effective` = yang dipakai tampilan. toggle(): optimistis (langsung tampil), lalu PUT. PUT DISERIALISASI: satu PUT berjalan pada satu waktu (urutan tiba di
// server tidak dijamin pada serverless); perubahan yang datang saat PUT berjalan menandai "kotor" dan giliran berikutnya mengirim state TERBARU (bukan
// snapshot lama), jadi layar dan server berakhir sama. Gagal -> toast dan kembali ke nilai terkonfirmasi, kecuali masih ada perubahan menunggu (yang akan
// mengirim state terbaru). Pertama kali toggle, daftar eksplisit dimulai dari bawaan.
export function usePins(creds: string) {
  const toast = useToast();
  const [pins, setPins] = useState<string[] | null>(null);
  const confirmed = useRef<string[] | null>(null);
  const current = useRef<string[] | null>(null);
  const username = useRef('');
  const dirty = useRef(false);
  const running = useRef(false);
  const credsRef = useRef(creds);
  useEffect(() => { credsRef.current = creds; });
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });

  const hydrate = useCallback((name: string, server: unknown) => {
    const next = resolvePins(server, readCachedPins(name));
    username.current = name;
    confirmed.current = next;
    current.current = next;
    writeCachedPins(name, next);
    setPins(next);
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (dirty.current) {
        dirty.current = false;
        const sending = current.current;
        const owner = username.current;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SAVE_TIMEOUT_MS);
        try {
          const res = await fetch('/api/me/pins', {
            method: 'PUT',
            headers: { 'x-admin-auth': credsRef.current, 'Content-Type': 'application/json' },
            body: JSON.stringify({ pins: sending }),
            signal: ctrl.signal,
          });
          if (!res.ok) throw new Error(`/api/me/pins ${res.status}`);
          if (owner === username.current) {
            confirmed.current = sending;
            writeCachedPins(owner, sending);
          }
        } catch (err) {
          console.error('Gagal menyimpan menu yang disematkan', err);
          if (!dirty.current && owner === username.current) {
            current.current = confirmed.current;
            setPins(confirmed.current);
            toastRef.current.error('Gagal menyimpan menu yang disematkan. Dikembalikan ke pengaturan sebelumnya.');
          }
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      running.current = false;
    }
  }, []);

  const persist = useCallback((next: string[] | null) => {
    current.current = next;
    setPins(next);
    dirty.current = true;
    void drain();
  }, [drain]);

  const toggle = useCallback((tab: string) => {
    if (!isPinnable(tab)) return;
    const base = current.current;
    const next = togglePin(base, tab);
    if (next.length > MAX_PINS) { toastRef.current.error(`Maksimum ${MAX_PINS} menu yang bisa disematkan.`); return; }
    if (samePins(next, base)) return;
    persist(next);
  }, [persist]);

  const reset = useCallback(() => { persist(null); }, [persist]);

  return { pins, effective: effectivePins(pins), toggle, reset, hydrate };
}
