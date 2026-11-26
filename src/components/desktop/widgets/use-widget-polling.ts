'use client';

import { useEffect, useRef } from 'react';

export interface PollContext {
  signal: AbortSignal;
  /** false bila sudah ada putaran lebih baru, polling dihentikan, atau komponen unmount: buang hasilnya (penjaga urutan respons). */
  isLatest: () => boolean;
}

const POLL_TIMEOUT_MS = 15_000;

/**
 * Polling untuk widget berdata. Berjalan hanya bila `active` DAN tab browser terlihat DAN jendela browser fokus; saat itu berhenti (timer dibersihkan,
 * request berjalan dibatalkan) dan menjalankan fn segera saat aktif kembali. Tidak pernah dua fn berjalan bersamaan (tik dilewati bila masih berjalan).
 * fn mengerjakan fetch dengan ctx.signal dan hanya menulis state bila ctx.isLatest(). Galat dari fn ditangkap dan dilog (fn sebaiknya menanganinya sendiri).
 */
export function useWidgetPolling(fn: (ctx: PollContext) => Promise<void> | void, intervalMs: number, active: boolean): void {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    if (!active) return;
    let run = 0;
    let busy = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let ctrl: AbortController | null = null;
    let disposed = false;

    const tick = async () => {
      if (busy || disposed) return;
      busy = true;
      const mine = ++run;
      const c = new AbortController();
      ctrl = c;
      const timeout = setTimeout(() => c.abort(), POLL_TIMEOUT_MS);
      try {
        await fnRef.current({ signal: c.signal, isLatest: () => !disposed && mine === run && !c.signal.aborted });
      } catch (err) {
        if (!c.signal.aborted) console.warn('Polling widget gagal', err);
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    const running = () => document.visibilityState !== 'hidden' && document.hasFocus();
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
      ctrl?.abort();
      run++;   // hasil putaran yang masih berjalan menjadi usang
    };
    const start = () => {
      if (timer || disposed) return;
      void tick();
      timer = setInterval(() => { void tick(); }, intervalMs);
    };
    const sync = () => { if (running()) start(); else stop(); };

    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    return () => {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
    };
  }, [active, intervalMs]);
}
