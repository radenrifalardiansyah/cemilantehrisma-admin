'use client';

import { useCallback, useSyncExternalStore } from 'react';

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

const subscribe = (notify: () => void) => {
  for (const e of EVENTS) document.addEventListener(e, notify);
  return () => { for (const e of EVENTS) document.removeEventListener(e, notify); };
};
const isFs = () => { const d = document as FsDoc; return !!(d.fullscreenElement ?? d.webkitFullscreenElement); };
const isSupported = () => { const d = document as FsDoc; return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled); };
const noopSubscribe = () => () => {};

// Layar penuh BROWSER (Fullscreen API) untuk seluruh halaman. SSR-aman (snapshot server = false), state mengikuti document (jadi Esc dari
// browser ikut tersinkron lewat 'fullscreenchange'), dan `supported` false di peramban yang tak mendukung (mis. iPhone Safari) -> tombol disembunyikan.
// Kegagalan (izin ditolak / bukan dari gestur pengguna) tidak dilempar: dilaporkan ke `onError` bila ada, selain itu diam.
export function useFullscreen(onError?: (err: unknown) => void) {
  const isFullscreen = useSyncExternalStore(subscribe, isFs, () => false);
  const supported = useSyncExternalStore(noopSubscribe, isSupported, () => false);

  const toggle = useCallback(async () => {
    try {
      const d = document as FsDoc;
      if (isFs()) {
        await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      } else {
        const el = document.documentElement as FsEl;
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch (err) {
      onError?.(err);
    }
  }, [onError]);

  return { isFullscreen, supported, toggle };
}
