'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { readCachedWidgets, resolveWidgets, sameWidgets, writeCachedWidgets, type WidgetConfig, type WidgetInstance } from '@/lib/widgets';

const SAVE_TIMEOUT_MS = 15_000;
/** Jeda simpan untuk perubahan config yang cepat berulang (mengetik catatan). Perubahan struktur (tambah/pindah/ukuran/hapus) langsung disimpan. */
export const CONFIG_DEBOUNCE_MS = 800;
const EMPTY: WidgetInstance[] = [];

// Widget tampilan depan Desktop (per pengguna, disimpan di server). Pola use-pins: optimistis, rollback ke keadaan TERKONFIRMASI bila gagal (toast),
// hydrate dari /api/me (+ cache perangkat). Tambahan:
// - PUT DISERIALISASI: satu PUT berjalan pada satu waktu (urutan tiba di server tidak dijamin pada serverless). Perubahan yang datang selama PUT berjalan
//   hanya menandai "kotor"; giliran berikutnya mengirim state TERBARU (bukan snapshot lama), jadi perubahan beruntun digabung dan server selalu berakhir
//   di state yang sama dengan layar. Rollback hanya bila gagal dan tidak ada perubahan/ketikan yang menunggu.
// - apply(mutator): perubahan struktur; mutator menerima daftar terbaru dan mengembalikan daftar baru atau null (ditolak). Mengembalikan true bila diterima.
// - setConfig(id, config): perubahan isi widget (mis. ketikan catatan): state langsung berubah, penyimpanan di-debounce CONFIG_DEBOUNCE_MS dan di-flush
//   saat unmount / halaman ditutup (pagehide, tab disembunyikan) atau saat ada perubahan struktur (yang selalu membawa config terbaru).
// - Respons PUT tidak menulis state kecuali rollback; hydrate diabaikan (untuk username sama) selama ada simpanan berjalan/tertunda. Hydrate untuk username
//   LAIN membuang ketikan tertunda pengguna lama (setelah mem-flush-nya dengan kredensial lama bila tidak ada PUT berjalan).
export function useWidgets(creds: string) {
  const toast = useToast();
  const [widgets, setWidgets] = useState<WidgetInstance[] | null>(null);
  const confirmed = useRef<WidgetInstance[] | null>(null);
  const current = useRef<WidgetInstance[] | null>(null);
  const username = useRef('');
  const dirty = useRef(false);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const credsRef = useRef(creds);
  useEffect(() => { credsRef.current = creds; });
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  // Satu pengirim: mengirim state terbaru selama masih kotor.
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (dirty.current) {
        dirty.current = false;
        const sending = current.current;
        const owner = username.current;
        const ctrl = new AbortController();
        const abortTimer = setTimeout(() => ctrl.abort(), SAVE_TIMEOUT_MS);
        try {
          const res = await fetch('/api/me/widgets', {
            method: 'PUT',
            headers: { 'x-admin-auth': credsRef.current, 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgets: sending }),
            signal: ctrl.signal,
            keepalive: true,
          });
          if (!res.ok) throw new Error(`/api/me/widgets ${res.status}`);
          if (owner === username.current) {
            confirmed.current = sending;
            writeCachedWidgets(owner, sending);
          }
        } catch (err) {
          console.error('Gagal menyimpan widget', err);
          // Rollback hanya bila tidak ada perubahan/ketikan yang menunggu (yang menunggu akan mengirim state terbaru) dan pemiliknya masih pengguna ini.
          if (!dirty.current && !timer.current && owner === username.current) {
            current.current = confirmed.current;
            setWidgets(confirmed.current);
            toastRef.current.error('Gagal menyimpan widget. Dikembalikan ke pengaturan sebelumnya.');
          }
        } finally {
          clearTimeout(abortTimer);
        }
      }
    } finally {
      running.current = false;
    }
  }, []);

  const persist = useCallback((next: WidgetInstance[] | null) => {
    clearTimer();
    current.current = next;
    setWidgets(next);
    dirty.current = true;
    void drain();
  }, [drain]);

  const hydrate = useCallback((name: string, server: unknown) => {
    if (name === username.current) {
      if (timer.current || running.current || dirty.current) return;
    } else if (username.current) {
      // Pengguna lain: ketikan tertunda pengguna lama dikirim dulu dengan kredensial lama (bila tidak ada PUT berjalan), lalu dibuang.
      if (timer.current && !running.current && current.current) { clearTimer(); dirty.current = true; void drain(); }
      clearTimer();
      dirty.current = false;
    }
    const next = resolveWidgets(server, readCachedWidgets(name));
    username.current = name;
    confirmed.current = next;
    current.current = next;
    writeCachedWidgets(name, next);
    setWidgets(next);
  }, [drain]);

  const apply = useCallback((mutator: (cur: WidgetInstance[]) => WidgetInstance[] | null): boolean => {
    const base = current.current ?? EMPTY;
    const next = mutator(base);
    if (!next) return false;
    if (current.current !== null && sameWidgets(next, base)) return true;
    if (current.current === null && next.length === 0) return true;
    persist(next);
    return true;
  }, [persist]);

  const flush = useCallback(() => {
    if (!timer.current) return;
    persist(current.current);   // persist membersihkan timer
  }, [persist]);

  const setConfig = useCallback((id: string, config: WidgetConfig) => {
    const base = current.current;
    if (!base || !base.some(w => w.id === id)) return;
    const next = base.map(w => (w.id === id ? { ...w, config } : w));
    current.current = next;
    setWidgets(next);
    clearTimer();
    timer.current = setTimeout(() => { timer.current = null; persist(current.current); }, CONFIG_DEBOUNCE_MS);
  }, [persist]);

  // Flush saat halaman ditutup/disembunyikan dan saat unmount (pakai ref ke flush terbaru supaya efek dipasang sekali).
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushRef.current(); };
    const onPageHide = () => flushRef.current();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flushRef.current();
    };
  }, []);

  return { widgets: widgets ?? EMPTY, raw: widgets, apply, setConfig, flush, hydrate, notifyError: toast.error };
}
