'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { TopbarSlotContext } from '@/components/TopbarPortal';
import AppTile from './AppTile';
import type { DesktopItem } from './types';
import { renderRect, type WinArea, type WinState } from './window-reducer';
import { WindowVisibleContext } from './window-visible';

interface Props {
  win: WinState;
  area: WinArea;
  item: DesktopItem;
  focused: boolean;
  zIndex: number;
  onFocus: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (rect: { x: number; y: number; w: number; h: number }) => void;
  /** Dilapor saat slot topbar terpasang/dilepas (dipakai Kasir, yang isinya dirender di luar pohon jendela). */
  onSlot?: (el: HTMLElement | null) => void;
  children: ReactNode;
}

// Lebar jendela di bawah ini: tombol berikon di slot titlebar hanya menampilkan ikon (lihat desktop.css).
export const NARROW_PX = 900;

type Drag = { kind: 'move' | 'e' | 's' | 'se'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number };

// Bingkai jendela: titlebar (geser lewat pointer events, dobel-klik = maksimalkan), tombol per skin
// (Windows: – ▢ ✕ di kanan; Mac: tiga bulatan di kiri), pegangan ubah ukuran, dan slot topbar untuk TopbarPortal tab.
export default function WindowFrame({ win, area, item, focused, zIndex, onFocus, onMinimize, onMaximize, onClose, onMove, onResize, onSlot, children }: Props) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const raf = useRef(0);

  // Jendela yang baru dibuka dan memang jendela terdepan langsung menerima fokus keyboard. (Bila semua jendela
  // dipasang ulang sekaligus, mis. kembali dari kerangka Klasik, hanya yang terdepan yang memfokus diri.)
  const onSlotRef = useRef(onSlot);
  useEffect(() => { onSlotRef.current = onSlot; });
  const slotRef = useCallback((el: HTMLElement | null) => { setSlot(el); onSlotRef.current?.(el); }, []);
  const startFocused = useRef(focused);
  useEffect(() => { if (startFocused.current) rootRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const r = renderRect(win, area);

  // Jenis geser dibaca dari data-drag elemen (bukan closure per jenis) supaya handler tidak dibuat dengan memanggil
  // fungsi yang menyentuh ref saat render.
  const onDown = (e: ReactPointerEvent<HTMLElement>) => {
    const kind = e.currentTarget.dataset.drag as Drag['kind'];
    if (e.button !== 0 || win.maximized) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('[data-nodrag]')) return;
    drag.current = { kind, sx: e.clientX, sy: e.clientY, ox: win.x, oy: win.y, ow: win.w, oh: win.h };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (kind === 'move') setDragging(true);
  };
  const track = useCallback((e: { clientX: number; clientY: number }) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (d.kind === 'move') onMove(d.ox + dx, d.oy + dy);
      else onResize({ x: d.ox, y: d.oy, w: d.kind === 'e' || d.kind === 'se' ? d.ow + dx : d.ow, h: d.kind === 's' || d.kind === 'se' ? d.oh + dy : d.oh });
    });
  }, [onMove, onResize]);
  const end = () => { drag.current = null; setDragging(false); };

  const dragProps = { onPointerDown: onDown, onPointerMove: track, onPointerUp: end, onPointerCancel: end };

  const style: CSSProperties = { left: r.x, top: r.y, width: r.w, height: r.h, zIndex };

  return (
    <div ref={rootRef} className="dsk-win" role="group" aria-label={item.label} tabIndex={0} hidden={win.minimized}
      data-focus={focused} data-max={win.maximized} data-narrow={r.w < NARROW_PX} style={style}
      onPointerDownCapture={onFocus} onFocusCapture={onFocus}>
      <div className="dsk-tb" data-drag="move" data-dragging={dragging} {...dragProps}
        onDoubleClick={e => { if (!(e.target as HTMLElement).closest('[data-nodrag]')) onMaximize(); }}>
        <span className="dsk-tl" data-nodrag>
          <button type="button" className="r" aria-label="Tutup" onClick={onClose} />
          <button type="button" className="y" aria-label="Kecilkan" onClick={onMinimize} />
          <button type="button" className="g" aria-label={win.maximized ? 'Pulihkan' : 'Besarkan'} onClick={onMaximize} />
        </span>
        <AppTile Icon={item.Icon} color={item.color} />
        <b className="dsk-title">{item.label}</b>
        <span className="dsk-tbslot" data-nodrag ref={slotRef} />
        <span className="dsk-wbs" data-nodrag>
          <button type="button" className="dsk-wb" aria-label="Kecilkan" onClick={onMinimize}><Minus size={14} /></button>
          <button type="button" className="dsk-wb" aria-label={win.maximized ? 'Pulihkan' : 'Besarkan'} onClick={onMaximize}><Square size={11} /></button>
          <button type="button" className="dsk-wb x" aria-label="Tutup" onClick={onClose}><X size={14} /></button>
        </span>
      </div>
      <div className="dsk-body">
        <WindowVisibleContext.Provider value={!win.minimized}>
          <TopbarSlotContext.Provider value={slot}>{children}</TopbarSlotContext.Provider>
        </WindowVisibleContext.Provider>
      </div>
      <span className="dsk-rs e" data-drag="e" aria-hidden="true" {...dragProps} />
      <span className="dsk-rs s" data-drag="s" aria-hidden="true" {...dragProps} />
      <span className="dsk-rs se" data-drag="se" aria-hidden="true" {...dragProps} />
    </div>
  );
}
