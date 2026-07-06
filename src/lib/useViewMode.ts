'use client';

import { useEffect, useState } from 'react';

export type ViewMode = 'table' | 'card';

export function useViewMode(key: string, defaultMode: ViewMode = 'table'): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(defaultMode);

  useEffect(() => {
    const stored = window.localStorage.getItem(`viewMode:${key}`);
    if (stored === 'table' || stored === 'card') {
      setMode(stored);
    } else if (window.innerWidth < 640) {
      setMode('card');
    }
  }, [key]);

  const update = (next: ViewMode) => {
    setMode(next);
    window.localStorage.setItem(`viewMode:${key}`, next);
  };

  return [mode, update];
}
