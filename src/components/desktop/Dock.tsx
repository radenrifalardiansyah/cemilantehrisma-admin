'use client';

import { useEffect, useRef } from 'react';
import { LayoutGrid } from 'lucide-react';
import AppTile from './AppTile';
import type { DesktopItem } from './types';

// Dock bawah (skin Mac): Launchpad + menu berjendela. Ikon membesar saat kursor mendekat, kecuali
// pengguna memilih gerakan berkurang (prefers-reduced-motion).
export default function Dock({ items, openTabs, launchpadOpen, onLaunchpad, onItem }: {
  items: DesktopItem[]; openTabs: ReadonlySet<string>; launchpadOpen: boolean; onLaunchpad: () => void; onItem: (item: DesktopItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('.dsk-dk') ?? []);

  const magnify = (e: React.MouseEvent) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const b of buttons()) {
      const r = b.getBoundingClientRect();
      const dist = Math.abs(e.clientX - (r.left + r.width / 2));
      b.style.transform = `scale(${(1 + 0.45 * Math.max(0, 1 - dist / 80)).toFixed(3)})`;
    }
  };
  const reset = () => { for (const b of buttons()) b.style.transform = ''; };

  // Roda mouse vertikal menggulir dock mendatar bila isinya meluap. Listener native non-passive (React memasang wheel sebagai passive sehingga
  // preventDefault tidak bekerja); bila dock tidak meluap, gulir halaman tidak diganggu.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const sc = el.querySelector<HTMLElement>('.dsk-dock-scroll');
      if (!sc || sc.scrollWidth <= sc.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      sc.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={ref} className="dsk-dock" role="toolbar" aria-label="Dock" onMouseMove={magnify} onMouseLeave={reset}>
      <div className="dsk-dock-scroll">
      <button type="button" className="dsk-dk" aria-label="Launchpad" aria-haspopup="dialog" aria-expanded={launchpadOpen} onClick={onLaunchpad}>
        <AppTile Icon={LayoutGrid} color="#5A4A3F" />
        <span className="tip">Launchpad</span>
      </button>
      <span className="dsk-sep" aria-hidden="true" />
      {items.map(i => (
        <button key={i.tab} type="button" className="dsk-dk" data-open={openTabs.has(i.tab)} aria-label={i.label} onClick={() => onItem(i)}>
          <AppTile Icon={i.Icon} color={i.color} />
          <span className="tip">{i.label}</span>
          <span className="dot" />
          {i.badge > 0 && <span className="dsk-badge" aria-hidden="true">{i.badge > 99 ? '99+' : i.badge}</span>}
        </button>
      ))}
      </div>
    </div>
  );
}
