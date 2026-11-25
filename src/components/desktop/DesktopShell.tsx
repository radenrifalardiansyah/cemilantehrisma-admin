'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { AppWindow } from 'lucide-react';
import { type UiLayout } from '@/lib/ui-layout';
import { DEFAULT_PINS } from '@/lib/pins';
import { DEFAULT_APPEARANCE, type Appearance } from '@/lib/appearance';
import { appearanceStyle } from '@/lib/appearance-style';
import AccountMenu from './AccountMenu';
import ContextMenu, { menuPointFromEvent, type MenuItem } from './ContextMenu';
import ShortcutsDialog from './ShortcutsDialog';
import { desktopMenu, itemMenu } from './context-menu-items';
import { useDesktopShortcuts } from './use-desktop-shortcuts';
import FullscreenButton from './FullscreenButton';
import { useFullscreen } from '@/lib/use-fullscreen';
import AppMenuPanel from './AppMenuPanel';
import DesktopIcons from './DesktopIcons';
import Dock from './Dock';
import MenuBar from './MenuBar';
import Taskbar from './Taskbar';
import WindowFrame from './WindowFrame';
import { MODULE_PALETTE, type DesktopGroup, type DesktopItem } from './types';
import { focusedTabId, type DesktopSkin, type WmAction, type WmState } from './window-reducer';
import './desktop.css';

export interface DesktopActions {
  open: (tab: string) => void;
  focus: (tab: string) => void;
  minimize: (tab: string) => void;
  maximize: (tab: string) => void;
  close: (tab: string) => void;
  move: (tab: string, x: number, y: number) => void;
  resize: (tab: string, rect: { x: number; y: number; w: number; h: number }) => void;
  /** Dispatch window manager mentah (tempel ke tepi, lepas dari maksimal, penanda geser selesai untuk geometri tersimpan). Opsional. */
  dispatch?: (a: WmAction) => void;
  arrange: () => void;
  closeAll: () => void;
}

interface Props {
  skin: DesktopSkin;
  layout: UiLayout;
  layoutBusy?: boolean;
  /** Pengaturan tampilan yang sedang dipratinjau/dipakai (warna dasar, latar, kerapatan, ukuran teks). */
  appearance?: Appearance;
  /** Menu yang disematkan (efektif, berurutan): jadi ikon meja / dock. Default = pintasan bawaan. `onTogglePin` kosong = tanpa bintang. */
  pins?: readonly string[];
  onTogglePin?: (tab: string) => void;
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
  // Menu klik kanan (satu per waktu) dan dialog daftar pintasan.
  const [ctx, setCtx] = useState<{ x: number; y: number; items: MenuItem[]; trigger: HTMLElement | null; label: string } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const closeCtx = useCallback(() => setCtx(null), []);
  const ap = p.appearance ?? DEFAULT_APPEARANCE;
  // Layar penuh browser (satu state untuk tombol tray/menu bar dan item menu akun).
  const fs = useFullscreen();
  const fsButton = <FullscreenButton supported={fs.supported} isFullscreen={fs.isFullscreen} onToggle={() => { void fs.toggle(); }} />;
  const { onChatSlot } = p;
  const chatSlotRef = useCallback((el: HTMLElement | null) => onChatSlot?.(el), [onChatSlot]);

  const items = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const itemByTab = useMemo(() => new Map(items.map(i => [i.tab, i])), [items]);
  const windowedItems = useMemo(() => items.filter(i => i.windowed), [items]);
  // Ikon meja / dock = menu yang disematkan, urutan = urutan pin. Id yang tidak ada di nav (dihapus / tak diizinkan) diabaikan tanpa error.
  const pinList = p.pins ?? DEFAULT_PINS;
  const pinSet = useMemo(() => new Set(pinList), [pinList]);
  const shortcutItems = useMemo(
    () => pinList.flatMap(t => { const it = itemByTab.get(t); return it && it.windowed ? [it] : []; }),
    [pinList, itemByTab],
  );
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

  // ── Menu klik kanan: wallpaper/area kosong, ikon meja, item dock, dan tombol jendela di taskbar. Klik kanan di dalam jendela (termasuk titlebar, isi,
  // kolom isian) TIDAK dicegat: menu bawaan peramban tetap muncul di sana.
  const winState = (tab: string) => { const w = wm.windows.find(x => x.tabId === tab); return w ? { minimized: w.minimized, maximized: w.maximized, focused: focused === tab } : undefined; };
  const openItemMenu = (tab: string, e: React.MouseEvent<HTMLElement>) => {
    const pt = menuPointFromEvent(e);
    setCtx({
      ...pt, trigger: e.currentTarget, label: `Menu ${itemFor(tab).label}`,
      items: itemMenu({ tab, win: winState(tab), pinned: pinSet.has(tab), onTogglePin: p.onTogglePin, open: actions.open, focus: actions.focus, minimize: actions.minimize, maximize: actions.maximize, close: actions.close }),
    });
  };
  const onRootContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('dsk-scrim')) { e.preventDefault(); return; }   // scrim panel: tanpa menu bawaan peramban, panel tetap terbuka, tanpa menu kita
    if (t !== e.currentTarget && !t.classList.contains('dsk-icons')) return;   // hanya area kosong desktop
    e.preventDefault();
    setMenuOpen(false);
    setCtx({
      ...menuPointFromEvent(e), trigger: null, label: 'Menu desktop',
      items: desktopMenu({
        hasWindows: wm.windows.length > 0, layout: p.layout, onAppearance: p.onOpenAppearance, arrange: actions.arrange, closeAll: actions.closeAll,
        changeLayout: p.onChangeLayout, fullscreen: fs.supported ? { isFullscreen: fs.isFullscreen, onToggle: () => { void fs.toggle(); } } : undefined,
        showShortcuts: () => setShowShortcuts(true),
      }),
    });
  };

  // ── Pintasan keyboard (Alt + tombol): aktif selama DesktopShell tampil (= mode Desktop).
  const snap = actions.dispatch ? (tab: string, side: 'left' | 'right' | 'top') => { actions.dispatch?.({ type: 'snap', tabId: tab, side }); actions.focus(tab); } : undefined;
  useDesktopShortcuts(true, {
    windows: wm.windows.map(w => ({ tabId: w.tabId, minimized: w.minimized, maximized: w.maximized, snapped: !!w.snapped })),
    focusedTab: focused, focus: actions.focus, minimize: actions.minimize, maximize: actions.maximize, close: actions.close, snap,
    openSearch: () => {
      setCtx(null);
      const input = document.querySelector<HTMLInputElement>('.dsk-menu input[type="search"]');
      if (input) input.focus(); else setMenuOpen(true);   // panel baru mem-fokus kolom cari sendiri (autoFocus)
    },
  });

  const account = (side: 'up' | 'down') => (
    <AccountMenu username={p.username} avatar={p.avatar} roleLabel={p.roleLabel} storeUrl={p.storeUrl} side={side}
      onEditProfile={p.onEditProfile} onAbout={p.onAbout} onLogout={p.onLogout} onAppearance={p.onOpenAppearance}
      fullscreen={fs.supported ? { isFullscreen: fs.isFullscreen, onToggle: () => { void fs.toggle(); } } : undefined} />
  );

  return (
    <div className="dsk-root" data-skin={skin} data-density={ap.density} data-text={ap.textSize} style={appearanceStyle(ap) as React.CSSProperties}
      onContextMenu={onRootContextMenu}>
      {skin === 'windows' && <DesktopIcons items={shortcutItems} onOpen={i => actions.open(i.tab)} onItemContext={(i, e) => openItemMenu(i.tab, e)} />}

      {wm.windows.map(w => (
        <WindowFrame key={w.tabId} win={w} area={wm.area} item={itemFor(w.tabId)} focused={focused === w.tabId} zIndex={rank.get(w.tabId) ?? 1}
          onFocus={() => actions.focus(w.tabId)} onMinimize={() => actions.minimize(w.tabId)}
          onMaximize={() => actions.maximize(w.tabId)} onClose={() => actions.close(w.tabId)}
          onMove={(x, y) => actions.move(w.tabId, x, y)} onResize={r => actions.resize(w.tabId, r)} dispatch={actions.dispatch} onSlot={w.tabId === 'pos' ? p.onPosSlot : undefined}>
          {p.content[w.tabId]}
        </WindowFrame>
      ))}

      {menuOpen && (
        <AppMenuPanel variant={skin === 'windows' ? 'start' : 'launchpad'} groups={groups} layout={p.layout} layoutBusy={p.layoutBusy}
          hasWindows={wm.windows.length > 0} onPick={pick} onClose={() => setMenuOpen(false)}
          onArrange={actions.arrange} onCloseAll={actions.closeAll} onChangeLayout={p.onChangeLayout} onAppearance={p.onOpenAppearance}
          pins={pinSet} onTogglePin={p.onTogglePin}
          account={skin === 'windows' ? { username: p.username, avatar: p.avatar, roleLabel: p.roleLabel, storeUrl: p.storeUrl, onEditProfile: p.onEditProfile, onAbout: p.onAbout, onLogout: p.onLogout,
            fullscreen: fs.supported ? { isFullscreen: fs.isFullscreen, onToggle: () => { void fs.toggle(); } } : undefined } : undefined} />
      )}

      {skin === 'windows' ? (
        <Taskbar startOpen={menuOpen} onToggleStart={() => setMenuOpen(o => !o)} onWindowClick={toggleFromBar} onWindowContext={openItemMenu}
          windows={wm.windows.map(w => ({ item: itemFor(w.tabId), minimized: w.minimized, focused: focused === w.tabId }))}
          tray={<>{fsButton}<span ref={chatSlotRef} className="dsk-chat-slot" />{p.renderBell('up')}{account('up')}</>} />
      ) : (
        <>
          <MenuBar windows={wm.windows.map(w => ({ tab: w.tabId, label: itemFor(w.tabId).label, minimized: w.minimized, maximized: w.maximized, focused: focused === w.tabId }))}
            actions={actions} layout={p.layout} layoutBusy={p.layoutBusy} onChangeLayout={p.onChangeLayout} onAppearance={p.onOpenAppearance}
            onAbout={p.onAbout} onEditProfile={p.onEditProfile} onLogout={p.onLogout} onShortcuts={() => setShowShortcuts(true)}
            fullscreen={fs.supported ? { isFullscreen: fs.isFullscreen, onToggle: () => { void fs.toggle(); } } : undefined} tray={<>{fsButton}<span ref={chatSlotRef} className="dsk-chat-slot" />{p.renderBell('down')}{account('down')}</>} />
          <Dock items={[...shortcutItems, ...windowedItems.filter(i => !pinSet.has(i.tab) && openTabs.has(i.tab))]} openTabs={openTabs} launchpadOpen={menuOpen} onLaunchpad={() => setMenuOpen(o => !o)}
            onItem={i => (focused === i.tab ? actions.minimize(i.tab) : actions.open(i.tab))} onItemContext={(i, e) => openItemMenu(i.tab, e)} />
        </>
      )}

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} label={ctx.label} returnFocus={ctx.trigger} bounds={wm.area} onClose={closeCtx} />}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
