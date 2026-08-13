'use client';

import { useEffect, useRef } from 'react';

// Pauses polling while the tab/window is hidden and immediately re-fires + resumes when it
// becomes visible again. Chat's heartbeat/unread/presence polls used to run full-speed forever
// once mounted (AppShell keeps ChatWidget mounted for the whole session), so a dashboard left
// open in a background tab all day kept hammering Firestore for status nobody was looking at.
export function useVisiblePolling(fn: () => void, intervalMs: number, deps: unknown[]) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => fnRef.current();
    const start = () => { if (!id) id = setInterval(tick, intervalMs); };
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { tick(); start(); }
    };

    if (!document.hidden) { tick(); start(); }
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
