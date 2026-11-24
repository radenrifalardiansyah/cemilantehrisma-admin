// Pilihan tata letak dashboard per pengguna: 'classic' (default, tampilan sidebar), 'windows'
// (meja + jendela + taskbar) atau 'mac' (menu bar + jendela + dock). Nilai tak dikenal SELALU jatuh ke
// 'classic' supaya pengguna yang tidak memilih apa pun mengalami tampilan yang sama seperti sebelumnya.

export type UiLayout = 'classic' | 'windows' | 'mac';

export const UI_LAYOUTS: readonly UiLayout[] = ['classic', 'windows', 'mac'];
export const DEFAULT_LAYOUT: UiLayout = 'classic';

// Sama dengan breakpoint `lg` Tailwind yang dipakai AppShell. Di bawah ini selalu Klasik.
export const DESKTOP_MIN_WIDTH = 1024;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

// Tahap 1: hanya menu ini yang bisa dibuka sebagai jendela. Menu lain tetap tampil di menu Mulai /
// Launchpad (ditandai "Klasik") dan dibuka sementara dengan kerangka Klasik.
// Tahap 3: keluarga Mitra yang berdiri sendiri sebagai menu — 'consignment' (Mitra; Lokasi/Kirim Stok/Rekap/Transfer Mitra
// adalah sub-tab DI DALAM tabnya), 'wa-forward' (Teruskan Stok WA, sub-menu Mitra), 'mitra-report' (Laporan Harian Mitra).
// Keluarga Titip Jual/Lapak ('consign', 'stall-*') sengaja belum berjendela.
export const WINDOW_TABS = ['dashboard', 'orders', 'products', 'wallets', 'income', 'expenses', 'pos', 'consignment', 'wa-forward', 'mitra-report'] as const;
export type WindowTabId = (typeof WINDOW_TABS)[number];

// Pintasan di meja Windows dan dock Mac (jangan penuhi layar). Menu berjendela lain tetap ada di Mulai/Launchpad,
// dan tampil di dock selama jendelanya terbuka.
export const DESKTOP_SHORTCUT_TABS: readonly WindowTabId[] = ['dashboard', 'pos', 'orders', 'products', 'wallets', 'income', 'expenses', 'consignment'];
export const isShortcutTab = (tab: string) => (DESKTOP_SHORTCUT_TABS as readonly string[]).includes(tab);

export function isWindowTab(tab: string): tab is WindowTabId {
  return (WINDOW_TABS as readonly string[]).includes(tab);
}

export function isUiLayout(value: unknown): value is UiLayout {
  return typeof value === 'string' && (UI_LAYOUTS as readonly string[]).includes(value);
}

export function parseLayout(value: unknown): UiLayout {
  return isUiLayout(value) ? value : DEFAULT_LAYOUT;
}

// Mode jendela hanya tampil bila pilihan bukan Klasik, layar >= lg, dan menu aktif berjendela.
export function isDesktopCapable(layout: UiLayout, isWide: boolean): boolean {
  return layout !== 'classic' && isWide;
}
export function isDesktopShown(layout: UiLayout, isWide: boolean, activeTab: string): boolean {
  return isDesktopCapable(layout, isWide) && isWindowTab(activeTab);
}

// ── Cache cepat di localStorage (kunci per username). Server tetap sumber kebenaran. ──
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function layoutStorageKey(username: string): string {
  return `ui-layout:${username}`;
}

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function readCachedLayout(username: string, storage: StorageLike | null = defaultStorage()): UiLayout | null {
  try {
    const raw = storage?.getItem(layoutStorageKey(username));
    return isUiLayout(raw) ? raw : null;
  } catch { return null; }
}

export function writeCachedLayout(username: string, layout: UiLayout, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(layoutStorageKey(username), layout); } catch { /* storage penuh/diblokir: abaikan */ }
}

// Server menang bila ada nilai valid; bila server tidak mengembalikan (kolom belum ada / DB sesaat
// bermasalah) pakai cache perangkat; terakhir Klasik.
export function resolveLayout(server: unknown, cached: UiLayout | null): UiLayout {
  if (isUiLayout(server)) return server;
  return cached ?? DEFAULT_LAYOUT;
}
