'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { AppWindow } from 'lucide-react';
import { isShortcutTab, type UiLayout } from '@/lib/ui-layout';
import { DEFAULT_APPEARANCE, type Appearance } from '@/lib/appearance';
import { appearanceStyle } from '@/lib/appearance-style';
import AccountMenu from './AccountMenu';
import FullscreenButton from './FullscreenButton';
import { useFullscreen } from '@/lib/use-fullscreen';
import AppMenuPanel from './AppMenuPanel';
import DesktopIcons from './DesktopIcons';
import Dock from './Dock';
import MenuBar from './MenuBar';
import Taskbar from './Taskbar';
import WindowFrame from './WindowFrame';
import { MODULE_PALETTE, type DesktopGroup, type DesktopItem } from './types';
import { focusedTabId, type DesktopSkin, type WmState } from './window-reducer';
import './desktop.css';

export interface DesktopActions {
  open: (tab: string) => void;
  focus: (tab: string) => void;
  minimize: (tab: string) => void;
  maximize: (tab: string) => void;
  close: (tab: string) => void;
  move: (tab: string, x: number, y: number) => void;
  resize: (tab: string, rect: { x: number; y: number; w: number; h: number }) => void;
  arrange: () => void;
  closeAll: () => void;
}

interface Props {
  skin: DesktopSkin;
  layout: UiLayout;
  layoutBusy?: boolean;
  /** Pengaturan tampilan yang sedang dipratinjau/dipakai (warna dasar, latar, kerapatan, ukuran teks). */
  appearance?: Appearance;
  onOpenAppearance?: () => void;
  wm: WmState;
  groups: DesktopGroup[];
  /** Isi tiap jendela (sudah di-memo oleh pemanggil supaya geser/fokus jendela tidak merender ulang isi tab). */
  content: Record<string, ReactNode>;
  username: string;
  avatar: string | null;
  roleLabel: string;
  storeUrl: string;
  /** Bel notifikasi milik AppShell (satu-satunya instance); `side`/`tone` menyesuaikan letaknya. */
  renderBell: (side: 'up' | 'down') => ReactNode;
  actions: DesktopActions;
  /** Slot topbar jendela Kasir (untuk TopbarPortal milik PosTab). Harus stabil (setter state). */
  onPosSlot?: (el: HTMLElement | null) => void;
  /** Slot tray untuk tombol chat (skin Windows). Harus stabil (setter state). */
  onChatSlot?: (el: HTMLElement | null) => void;
  onPickMenu: (item: DesktopItem) => void;
  onChangeLayout: (next: UiLayout) => void;
  onEditProfile: () => void;
  onAbout: () => void;
  onLogout: () => void;
}

// Kerangka mode Desktop: meja + jendela + taskbar/menu Mulai (Windows) atau menu bar + dock + Launchpad (Mac).
// Statusnya (jendela) dipegang AppShell lewat useWindowManager; di sini hanya tampilan dan penerjemah klik.
export default function DesktopShell(p: Props) {
  const { skin, wm, groups, actions } = p;
  const [menuOpen, setMenuOpen] = useState(false);
  const ap = p.appearance ?? DEFAULT_APPEARANCE;
  // Layar penuh browser (satu state untuk tombol tray/menu bar dan item menu akun).
  const fs = useFullscreen();
  const fsButton = <FullscreenButton supported={fs.supported} isFullscreen={fs.isFullscreen} onToggle={() => { void fs.toggle(); }} />;
  const { onChatSlot } = p;
  const chatSlotRef = useCallback((el: HTMLElement | null) => onChatSlot?.(el), [onChatSlot]);

  const items = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const itemByTab = useMemo(() => new Map(items.map(i => [i.tab, i])), [items]);
  const windowedItems = useMemo(() => items.filter(i => i.windowed), [items]);
  const shortcutItems = useMemo(() => windowedItems.filter(i => isShortcutTab(i.tab)), [windowedItems]);
  const itemFor = (tab: string): DesktopItem =>
    itemByTab.get(tab) ?? { tab, label: tab, Icon: AppWindow, color: MODULE_PALETTE[0], windowed: true, badge: 0 };

  const focused = focusedTabId(wm);
  const openTabs = useMemo(() => new Set(wm.windows.map(w => w.tabId)), [wm.windows]);
  // zIndex dirender sebagai peringkat (1..n) supaya counter z tidak pernah menembus taskbar/dock (5000).
  const rank = useMemo(() => new Map([...wm.windows].sort((a, b) => a.z - b.z).map((w, i) => [w.tabId, i + 1])), [wm.windows]);

  const toggleFromBar = (tab: string) => {
    const w = wm.windows.find(x => x.tabId === tab);
    if (!w) return actions.open(tab);
    if (w.minimized) actions.open(tab);
    else if (focused === tab) actions.minimize(tab);
    else actions.focus(tab);
  };
  const pick = (item: DesktopItem) => { setMenuOpen(false); p.onPickMenu(item); };

  const account = (side: 'up' | 'down') => (
    <AccountMenu username={p.username} avatar={p.avatar} roleLabel={p.roleLabel} storeUrl={p.storeUrl} side={side}
      onEditProfile={p.onEditProfile} onAbout={p.onAbout} onLogout={p.onLogout} onAppearance={p.onOpenAppearance}
      fullscreen={fs.supported ? { isFullscreen: fs.isFullscreen, onToggle: () => { void fs.toggle(); } } : undefined} />
  );

  return (
    <div className="dsk-root" data-skin={skin} data-density={ap.density} data-text={ap.textSize} style={appearanceStyle(ap) as React.CSSProperties}>
      {skin === 'windows' && <DesktopIcons items={shortcutItems} onOpen={i => actions.open(i.tab)} />}

      {wm.windows.map(w => (
        <WindowFrame key={w.tabId} win={w} area={wm.area} item={itemFor(w.tabId)} focused={focused === w.tabId} zIndex={rank.get(w.tabId) ?? 1}
          onFocus={() => actions.focus(w.tabId)} onMinimize={() => actions.minimize(w.tabId)}
          onMaximize={() => actions.maximize(w.tabId)} onClose={() => actions.close(w.tabId)}
          onMove={(x, y) => actions.move(w.tabId, x, y)} onResize={r => actions.resize(w.tabId, r)} onSlot={w.tabId === 'pos' ? p.onPosSlot : undefined}>
          {p.content[w.tabId]}
        </WindowFrame>
      ))}

      {menuOpen && (
        <AppMenuPanel variant={skin === 'windows' ? 'start' : 'launchpad'} groups={groups} layout={p.layout} layoutBusy={p.layoutBusy}
          hasWindows={wm.windows.length > 0} onPick={pick} onClose={() => setMenuOpen(false)}
          onArrange={actions.arrange} onCloseAll={actions.closeAll} onChangeLayout={p.onChangeLayout} onAppearance={p.onOpenAppearance} />
      )}

      {skin === 'windows' ? (
        <Taskbar startOpen={menuOpen} onToggleStart={() => setMenuOpen(o => !o)} onWindowClick={toggleFromBar}
          windows={wm.windows.map(w => ({ item: itemFor(w.tabId), minimized: w.minimized, focused: focused === w.tabId }))}
          tray={<>{fsButton}<span ref={chatSlotRef} className="dsk-chat-slot" />{p.renderBell('up')}{account('up')}</>} />
      ) : (
        <>
          <MenuBar title={focused ? itemFor(focused).label : 'Desktop'} tray={<>{fsButton}<span ref={chatSlotRef} className="dsk-chat-slot" />{p.renderBell('down')}{account('down')}</>} />
          <Dock items={windowedItems.filter(i => isShortcutTab(i.tab) || openTabs.has(i.tab))} openTabs={openTabs} launchpadOpen={menuOpen} onLaunchpad={() => setMenuOpen(o => !o)}
            onItem={i => (focused === i.tab ? actions.minimize(i.tab) : actions.open(i.tab))} />
        </>
      )}
    </div>
  );
}
