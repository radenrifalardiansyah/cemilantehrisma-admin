import type { LucideIcon } from 'lucide-react';

// Satu menu pada menu Mulai / Launchpad / ikon. `windowed` = bisa dibuka sebagai jendela (WINDOW_TABS);
// yang lain tampil dengan tanda "Klasik" dan dibuka lewat kerangka Klasik sementara.
export interface DesktopItem {
  tab: string;
  label: string;
  Icon: LucideIcon;
  color: string;
  windowed: boolean;
  badge: number;
}

export interface DesktopGroup {
  id: string;
  label: string;
  items: DesktopItem[];
}

// Palet tetap warna ubin per modul (urutan modul di Struktur Menu -> warna).
export const MODULE_PALETTE = ['#D4691E', '#0284C7', '#15803D', '#7C3AED', '#6B7280', '#DB2777', '#0D9488', '#CA8A04'] as const;
export const PINNED_COLOR = '#B91C1C';

export const moduleColor = (index: number) => MODULE_PALETTE[((index % MODULE_PALETTE.length) + MODULE_PALETTE.length) % MODULE_PALETTE.length];
