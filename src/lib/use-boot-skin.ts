'use client';

import { useSyncExternalStore } from 'react';
import { DESKTOP_MEDIA_QUERY, readLastLayout, resolveBootSkin } from '@/lib/ui-layout';
import { LAST_APPEARANCE_KEY, parseAppearance, type Appearance } from '@/lib/appearance';

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

// Pengaturan tampilan terakhir (cache perangkat) untuk layar memuat Desktop. Snapshot berupa string mentah (stabil) lalu di-parse.
export function useBootAppearance(): Appearance | null {
  const raw = useSyncExternalStore(() => () => {}, () => { try { return localStorage.getItem(LAST_APPEARANCE_KEY); } catch { return null; } }, () => null);
  return raw ? parseAppearance(raw) : null;
}
