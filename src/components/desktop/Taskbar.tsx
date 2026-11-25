'use client';

import type { ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';
import AppTile from './AppTile';
import Clock from './Clock';
import type { DesktopItem } from './types';

export interface TaskbarWindow { item: DesktopItem; minimized: boolean; focused: boolean }

// Taskbar bawah (skin Windows): tombol Mulai, tombol per jendela, tray (bel notifikasi, akun, jam).
export default function Taskbar({ windows, startOpen, onToggleStart, onWindowClick, onWindowContext, tray }: {
  windows: TaskbarWindow[]; startOpen: boolean; onToggleStart: () => void; onWindowClick: (tab: string) => void; tray: ReactNode;
  /** Klik kanan / tombol Menu pada tombol jendela: membuka menu konteks jendela. */
  onWindowContext?: (tab: string, e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="dsk-task" role="toolbar" aria-label="Taskbar">
      <button type="button" className="dsk-start" aria-label="Menu Mulai" aria-haspopup="dialog" aria-expanded={startOpen} onClick={onToggleStart}>
        <LayoutGrid size={18} />
      </button>
      <div className="dsk-tbtns">
        {windows.map(w => (
          <button key={w.item.tab} type="button" className="dsk-tbtn" data-on={w.focused} data-min={w.minimized}
            aria-label={w.item.label} aria-pressed={w.focused} onClick={() => onWindowClick(w.item.tab)}
            onContextMenu={onWindowContext ? e => { e.preventDefault(); onWindowContext(w.item.tab, e); } : undefined}>
            <AppTile Icon={w.item.Icon} color={w.item.color} />
            <span>{w.item.label}</span>
          </button>
        ))}
      </div>
      <div className="dsk-tray">{tray}<Clock /></div>
    </div>
  );
}
