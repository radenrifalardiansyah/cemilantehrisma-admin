import { AppWindow, ExternalLink, Eye, Keyboard, Layers, LayoutGrid, LayoutTemplate, Maximize, Maximize2, Minimize, Minimize2, Palette, Pin, PinOff, Plus, RectangleHorizontal, Square, Trash2, X, type LucideIcon } from 'lucide-react';
import type { MenuItem } from './ContextMenu';
import type { UiLayout } from '@/lib/ui-layout';
import type { WidgetSize } from '@/lib/widgets';

// Pembangun isi menu klik kanan (murni, diuji terpisah). Aksi memakai actions yang sudah ada di DesktopShell.
export interface WindowState { minimized: boolean; maximized: boolean; focused: boolean }

export interface ItemMenuCtx {
  tab: string;
  /** Keadaan jendela tab ini bila terbuka; undefined = belum terbuka. */
  win?: WindowState;
  pinned: boolean;
  /** Tanpa pengelola pin, item sematkan/lepas tidak ditampilkan. */
  onTogglePin?: (tab: string) => void;
  open: (tab: string) => void;
  focus: (tab: string) => void;
  minimize: (tab: string) => void;
  maximize: (tab: string) => void;
  close: (tab: string) => void;
}

// Ikon meja Windows / item dock Mac / tombol jendela di taskbar: sama-sama menu tentang satu menu/jendela.
export function itemMenu(c: ItemMenuCtx): MenuItem[] {
  const out: MenuItem[] = [];
  if (!c.win) out.push({ id: 'open', label: 'Buka', Icon: ExternalLink, onSelect: () => c.open(c.tab) });
  else {
    out.push({ id: 'focus', label: c.win.minimized ? 'Pulihkan' : 'Fokus', Icon: Eye, onSelect: () => c.open(c.tab) });
    out.push({ id: 'min', label: 'Kecilkan', Icon: Minimize2, disabled: c.win.minimized, onSelect: () => c.minimize(c.tab) });
    out.push({ id: 'max', label: c.win.maximized ? 'Pulihkan ukuran' : 'Maksimalkan', Icon: c.win.maximized ? Minimize : Maximize2, onSelect: () => c.maximize(c.tab) });
    out.push({ id: 'close', label: 'Tutup', Icon: X, danger: true, onSelect: () => c.close(c.tab) });
  }
  if (c.onTogglePin) {
    const toggle = c.onTogglePin;
    out.push({ id: 'sep-pin', separator: true });
    out.push({ id: 'pin', label: c.pinned ? 'Lepas dari desktop' : 'Sematkan ke desktop', Icon: c.pinned ? PinOff : Pin, onSelect: () => toggle(c.tab) });
  }
  return out;
}

export interface DesktopMenuCtx {
  hasWindows: boolean;
  layout: UiLayout;
  onAppearance?: () => void;
  arrange: () => void;
  closeAll: () => void;
  changeLayout: (next: UiLayout) => void;
  fullscreen?: { isFullscreen: boolean; onToggle: () => void };
  showShortcuts: () => void;
  /** Item "Tambah widget" (hanya bila ada pengelola widget): tipe yang diizinkan pengguna; disabled bila penuh/tidak ada slot. */
  widgets?: { add: { type: string; label: string; Icon: LucideIcon; disabled?: boolean }[]; onAdd: (type: string) => void };
}

const LAYOUT_LABEL: Record<UiLayout, string> = { classic: 'Klasik', windows: 'Windows', mac: 'Mac' };

// Menu klik kanan wallpaper / area kosong desktop.
export function desktopMenu(c: DesktopMenuCtx): MenuItem[] {
  const out: MenuItem[] = [];
  if (c.onAppearance) out.push({ id: 'appearance', label: 'Personalisasi', Icon: Palette, onSelect: c.onAppearance });
  out.push({ id: 'arrange', label: 'Susun ulang jendela', Icon: Layers, disabled: !c.hasWindows, onSelect: c.arrange });
  out.push({ id: 'closeall', label: 'Tutup semua jendela', Icon: X, disabled: !c.hasWindows, onSelect: c.closeAll });
  if (c.widgets && c.widgets.add.length > 0) {
    const w = c.widgets;
    out.push({ id: 'sep-widgets', separator: true });
    for (const a of w.add) out.push({ id: `widget-add-${a.type}`, label: `Tambah widget: ${a.label}`, Icon: Plus, disabled: a.disabled, onSelect: () => w.onAdd(a.type) });
  }
  out.push({ id: 'sep-layout', separator: true });
  for (const l of ['classic', 'windows', 'mac'] as const) {
    out.push({ id: `layout-${l}`, label: `Tampilan ${LAYOUT_LABEL[l]}`, Icon: l === 'classic' ? LayoutGrid : AppWindow, checked: c.layout === l, onSelect: () => { if (c.layout !== l) c.changeLayout(l); } });
  }
  out.push({ id: 'sep-fs', separator: true });
  if (c.fullscreen) {
    const fs = c.fullscreen;
    out.push({ id: 'fullscreen', label: fs.isFullscreen ? 'Keluar dari layar penuh' : 'Layar penuh', Icon: fs.isFullscreen ? Minimize : Maximize, onSelect: fs.onToggle });
  }
  out.push({ id: 'shortcuts', label: 'Pintasan keyboard', Icon: Keyboard, onSelect: c.showShortcuts });
  return out;
}

export interface WidgetMenuCtx {
  size: WidgetSize;
  allowedSizes: readonly WidgetSize[];
  onSize: (size: WidgetSize) => void;
  onRemove: () => void;
}

const SIZE_LABEL: Record<WidgetSize, { label: string; Icon: LucideIcon }> = {
  s: { label: 'Kecil', Icon: Square },
  m: { label: 'Sedang', Icon: RectangleHorizontal },
  l: { label: 'Lebar', Icon: LayoutTemplate },
};

// Menu klik kanan kartu widget: pilihan ukuran (centang = saat ini; hanya ukuran yang diizinkan tipe widget) dan Hapus.
export function widgetMenu(c: WidgetMenuCtx): MenuItem[] {
  const out: MenuItem[] = [];
  for (const s of (['s', 'm', 'l'] as const).filter(x => c.allowedSizes.includes(x))) {
    out.push({ id: `size-${s}`, label: `Ukuran ${SIZE_LABEL[s].label}`, Icon: SIZE_LABEL[s].Icon, checked: c.size === s, onSelect: () => { if (c.size !== s) c.onSize(s); } });
  }
  out.push({ id: 'sep-remove', separator: true });
  out.push({ id: 'remove', label: 'Hapus widget', Icon: Trash2, danger: true, onSelect: c.onRemove });
  return out;
}
