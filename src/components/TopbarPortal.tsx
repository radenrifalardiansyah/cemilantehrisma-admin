'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Renders children into AppShell's #topbar-slot, so a tab's own refresh/action
// button can appear in the fixed top-right topbar instead of inline in the page.
export default function TopbarPortal({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById('topbar-slot'));
  }, []);

  if (!target) return null;
  return createPortal(children, target);
}
