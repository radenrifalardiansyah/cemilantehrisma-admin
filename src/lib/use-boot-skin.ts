'use client';

import { useSyncExternalStore } from 'react';
import { DESKTOP_MEDIA_QUERY, readLastLayout, resolveBootSkin } from '@/lib/ui-layout';

// Skin splash saat sesi dipulihkan. Server snapshot null supaya HTML awal sama dengan server (tanpa hydration mismatch);
// begitu hidrasi selesai nilai cache perangkat dipakai.
function snapshot(): 'windows' | 'mac' | null {
  try {
    return resolveBootSkin({
      last: readLastLayout(),
      hasSession: !!localStorage.getItem('admin_creds'),
      isWide: window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    });
  } catch { return null; }
}

export function useBootSkin() {
  return useSyncExternalStore(
    notify => {
      const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    snapshot,
    () => null,
  );
}
