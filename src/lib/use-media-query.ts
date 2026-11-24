'use client';

import { useSyncExternalStore } from 'react';

// true bila media query cocok. Di server / sebelum hidrasi = false (aman: false = tampilan Klasik).
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
