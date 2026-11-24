'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Slot topbar milik sebuah jendela (mode Desktop). `undefined` = tidak ada jendela di atas pohon ini,
// jadi dipakai #topbar-slot milik AppShell seperti biasa. `null` = jendela ada tapi slotnya belum
// terpasang: tunggu, JANGAN jatuh ke slot AppShell (tombolnya akan muncul di topbar yang salah).
export const TopbarSlotContext = createContext<HTMLElement | null | undefined>(undefined);

export function resolveTopbarTarget(ctx: HTMLElement | null | undefined, lookup: () => HTMLElement | null): HTMLElement | null {
  return ctx !== undefined ? ctx : lookup();
}

// Renders children into AppShell's #topbar-slot, so a tab's own refresh/action
// button can appear in the fixed top-right topbar instead of inline in the page.
// Di dalam jendela Desktop, tujuannya slot di titlebar jendela itu (lihat TopbarSlotContext).
export default function TopbarPortal({ children }: { children: React.ReactNode }) {
  const slot = useContext(TopbarSlotContext);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(resolveTopbarTarget(slot, () => document.getElementById('topbar-slot')));
  }, [slot]);

  if (!target) return null;
  return createPortal(children, target);
}
