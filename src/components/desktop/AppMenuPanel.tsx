'use client';

import { useMemo, useState } from 'react';
import { useEscapeLayer } from '@/components/Modal';
import type { UiLayout } from '@/lib/ui-layout';
import AppTile from './AppTile';
import LayoutPicker from './LayoutPicker';
import type { DesktopGroup, DesktopItem } from './types';

// Panel menu bersama: "Mulai" (Windows) dan "Launchpad" (Mac). Memuat SEMUA menu yang boleh dilihat pengguna;
// yang belum berjendela ditandai "Klasik". Esc / klik di luar menutup.
interface Props {
  variant: 'start' | 'launchpad';
  groups: DesktopGroup[];
  layout: UiLayout;
  hasWindows: boolean;
  layoutBusy?: boolean;
  onPick: (item: DesktopItem) => void;
  onClose: () => void;
  onArrange: () => void;
  onCloseAll: () => void;
  onChangeLayout: (next: UiLayout) => void;
}

export default function AppMenuPanel({ variant, groups, layout, hasWindows, layoutBusy, onPick, onClose, onArrange, onCloseAll, onChangeLayout }: Props) {
  const [q, setQ] = useState('');
  const [showLayouts, setShowLayouts] = useState(false);
  useEscapeLayer(onClose);

  const query = q.trim().toLowerCase();
  const visible = useMemo(() => groups
    .map(g => ({ ...g, items: g.items.filter(i => !query || i.label.toLowerCase().includes(query) || g.label.toLowerCase().includes(query)) }))
    .filter(g => g.items.length > 0), [groups, query]);
  const firstMatch = visible[0]?.items[0];

  return (
    <>
      <div className="dsk-scrim" data-kind={variant} onPointerDown={onClose} />
      <div className="dsk-menu" data-variant={variant} role="dialog" aria-label={variant === 'start' ? 'Menu Mulai' : 'Launchpad'}>
        <input type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Cari menu…" aria-label="Cari menu" autoComplete="off"
          onKeyDown={e => { if (e.key === 'Enter' && firstMatch) onPick(firstMatch); }} />
        <div className="dsk-mscroll">
          {visible.length === 0 && <p className="dsk-empty">Menu tidak ditemukan</p>}
          {visible.map(g => (
            <section key={g.id} className="dsk-mgrp" aria-label={g.label}>
              <h4>{g.label}</h4>
              <div className="dsk-mitems">
                {g.items.map(i => (
                  <button key={i.tab} type="button" className="dsk-mi" onClick={() => onPick(i)} title={i.windowed ? i.label : `${i.label} (dibuka dengan tampilan Klasik)`}>
                    <AppTile Icon={i.Icon} color={i.color} />
                    <span className="lbl">{i.label}</span>
                    {!i.windowed && <span className="tag">Klasik</span>}
                    {i.badge > 0 && <span className="dsk-badge" aria-label={`${i.badge} baru`}>{i.badge > 99 ? '99+' : i.badge}</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="dsk-mfoot">
          {showLayouts && <LayoutPicker compact value={layout} disabled={layoutBusy} onChange={onChangeLayout} />}
          <div className="row">
            <button type="button" aria-expanded={showLayouts} onClick={() => setShowLayouts(s => !s)}>Ganti tampilan</button>
            <button type="button" disabled={!hasWindows} onClick={() => { onArrange(); onClose(); }}>Susun ulang jendela</button>
            <button type="button" disabled={!hasWindows} onClick={() => { onCloseAll(); onClose(); }}>Tutup semua</button>
          </div>
        </div>
      </div>
    </>
  );
}
