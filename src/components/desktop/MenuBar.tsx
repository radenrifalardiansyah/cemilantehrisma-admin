'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import type { UiLayout } from '@/lib/ui-layout';
import Clock from './Clock';
import MenuBarMenus, { type MenuDef, type MenuEntry } from './MenuBarMenu';

export const STORE_NAME = 'Cemilan Teh Risma';

export interface MenuBarWindow { tab: string; label: string; minimized: boolean; maximized: boolean; focused: boolean }

interface Props {
  tray: ReactNode;
  windows: MenuBarWindow[];
  actions: {
    open: (tab: string) => void; focus: (tab: string) => void; minimize: (tab: string) => void; maximize: (tab: string) => void;
    close: (tab: string) => void; arrange: () => void; closeAll: () => void;
  };
  layout: UiLayout;
  layoutBusy?: boolean;
  onChangeLayout: (next: UiLayout) => void;
  onAppearance?: () => void;
  onAbout: () => void;
  onEditProfile: () => void;
  onLogout: () => void;
  /** Layar penuh (hanya bila didukung peramban). */
  fullscreen?: { isFullscreen: boolean; onToggle: () => void };
  /** Titik sambung opsional: tampilkan "Pintasan keyboard" di menu Bantuan. */
  onShortcuts?: () => void;
}

const LAYOUTS: { id: UiLayout; label: string }[] = [{ id: 'classic', label: 'Klasik' }, { id: 'windows', label: 'Windows' }, { id: 'mac', label: 'Mac' }];
const sep = (id: string): MenuEntry => ({ kind: 'sep', id });
const item = (id: string, label: string, onSelect: () => void, extra: Partial<Extract<MenuEntry, { kind: 'item' }>> = {}): MenuEntry => ({ kind: 'item', id, label, onSelect, ...extra });

// Menu bar atas (skin Mac): menu Apple (logo toko), nama aplikasi aktif (judul jendela terdepan), Jendela, Tampilan, Bantuan; kanan: tray (layar penuh, chat, bel, akun, jam).
export default function MenuBar(p: Props) {
  const { windows: wins, actions: a } = p;
  const front = wins.find(w => w.focused);
  const layoutEntries: MenuEntry[] = [
    { kind: 'label', id: 'lay-h', label: 'Ganti tampilan' },
    ...LAYOUTS.map(l => item(`lay-${l.id}`, l.label, () => p.onChangeLayout(l.id), { role: 'menuitemradio', checked: p.layout === l.id, disabled: p.layoutBusy })),
  ];
  const fsEntry = p.fullscreen ? [item('fs', p.fullscreen.isFullscreen ? 'Keluar dari layar penuh' : 'Layar penuh', p.fullscreen.onToggle)] : [];
  const appearance = p.onAppearance ? [item('look', 'Personalisasi', p.onAppearance)] : [];

  const menus: MenuDef[] = [
    {
      id: 'apple', label: `Menu ${STORE_NAME}`,
      trigger: <Image src="/icon-192.png" alt="" width={18} height={18} />,
      entries: [
        item('about', 'Tentang aplikasi', p.onAbout), sep('s1'),
        ...appearance, ...layoutEntries, ...fsEntry, sep('s2'),
        item('profile', 'Edit Profil', p.onEditProfile), sep('s3'),
        item('logout', 'Keluar', p.onLogout, { danger: true }),
      ],
    },
    { id: 'app', label: front ? front.label : STORE_NAME, staticLabel: true },
    {
      id: 'window', label: 'Jendela',
      entries: [
        item('min', 'Kecilkan', () => front && a.minimize(front.tab), { disabled: !front }),
        item('max', front?.maximized ? 'Pulihkan' : 'Maksimalkan', () => front && a.maximize(front.tab), { disabled: !front }),
        item('close', 'Tutup jendela', () => front && a.close(front.tab), { disabled: !front }),
        sep('w1'),
        item('arrange', 'Susun ulang', a.arrange, { disabled: wins.length === 0 }),
        item('closeall', 'Tutup semua', a.closeAll, { disabled: wins.length === 0 }),
        sep('w2'),
        ...(wins.length === 0
          ? [item('none', 'Tidak ada jendela terbuka', () => {}, { disabled: true })]
          : wins.map(w => item(`win-${w.tab}`, w.minimized ? `${w.label} (dikecilkan)` : w.label,
              () => (w.minimized ? a.open(w.tab) : a.focus(w.tab)), { role: 'menuitemcheckbox', checked: w.focused }))),
      ],
    },
    { id: 'view', label: 'Tampilan', entries: [...fsEntry, ...appearance, ...(fsEntry.length || appearance.length ? [sep('v1')] : []), ...layoutEntries] },
    { id: 'help', label: 'Bantuan', entries: [item('about-h', 'Tentang aplikasi', p.onAbout), ...(p.onShortcuts ? [item('keys', 'Pintasan keyboard', p.onShortcuts)] : [])] },
  ];

  return (
    <div className="dsk-mbar" role="banner">
      <MenuBarMenus menus={menus} />
      <span className="sp" />
      <div className="dsk-tray">{p.tray}<Clock /></div>
    </div>
  );
}
