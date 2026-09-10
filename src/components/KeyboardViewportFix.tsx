'use client';

import { useEffect } from 'react';

/**
 * Mobile keyboards shrink the visual viewport but not the layout viewport, so a
 * `.modal-sheet` sized in `vh` can end up taller than what's actually visible —
 * its bottom (and whatever input the user just focused) gets covered by the
 * keyboard with no scrollable overflow to compensate. This mounts once at the
 * root and keeps a `--vvh` CSS var in sync with the real visual viewport height,
 * and nudges the focused field into view after the keyboard finishes animating in.
 */
export default function KeyboardViewportFix() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const syncHeight = () => {
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
    };
    syncHeight();
    vv.addEventListener('resize', syncHeight);
    vv.addEventListener('scroll', syncHeight);

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !('closest' in target)) return;
      if (!target.matches('input, textarea, select')) return;
      if (!target.closest('.modal-body')) return;
      setTimeout(() => {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 300);
    };
    document.addEventListener('focusin', onFocusIn);

    return () => {
      vv.removeEventListener('resize', syncHeight);
      vv.removeEventListener('scroll', syncHeight);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  return null;
}
