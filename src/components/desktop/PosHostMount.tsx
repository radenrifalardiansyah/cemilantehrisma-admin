'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

// Kasir (PosTab) harus tetap SATU instance yang ter-mount terus (keranjang awet), jadi tidak bisa dirender ulang di
// dalam jendela. Elemen host-nya (dimiliki AppShell, display:contents di kerangka Klasik) dipindahkan secara DOM ke
// slot jendela saat jendela dibuka, dan dikembalikan ke posisi semula saat jendela ditutup / DesktopShell dilepas.
// Pemindahan DOM tidak me-remount fiber React; cleanup layout-effect berjalan sebelum node jendela dicabut.
export default function PosHostMount({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const target = slot.current;
    if (!host || !target) return;
    const parent = host.parentNode;
    const next = host.nextSibling;
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.flex = '1 1 0';
    host.style.minHeight = '0';
    target.appendChild(host);
    return () => {
      host.style.display = 'contents';
      host.style.flexDirection = '';
      host.style.flex = '';
      host.style.minHeight = '';
      if (parent) parent.insertBefore(host, next && next.parentNode === parent ? next : null);
    };
  }, [hostRef]);
  return <div ref={slot} className="dsk-pos-slot" />;
}

// Nilai TopbarSlotContext untuk PosTab: tanpa jendela Kasir (Klasik / jendela ditutup) = undefined (pakai #topbar-slot);
// jendela Kasir ada tapi slotnya belum dilaporkan = null (TopbarPortal menunggu, tidak jatuh ke slot Klasik).
export function posTopbarContext(windowOpen: boolean, slot: HTMLElement | null | undefined): HTMLElement | null | undefined {
  return windowOpen ? (slot ?? null) : undefined;
}
