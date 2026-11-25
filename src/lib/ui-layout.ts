// Pilihan tata letak dashboard per pengguna: 'classic' (default, tampilan sidebar), 'windows'
// (meja + jendela + taskbar) atau 'mac' (menu bar + jendela + dock). Nilai tak dikenal SELALU jatuh ke
// 'classic' supaya pengguna yang tidak memilih apa pun mengalami tampilan yang sama seperti sebelumnya.

export type UiLayout = 'classic' | 'windows' | 'mac';

export const UI_LAYOUTS: readonly UiLayout[] = ['classic', 'windows', 'mac'];
export const DEFAULT_LAYOUT: UiLayout = 'classic';

// Sama dengan breakpoint `lg` Tailwind yang dipakai AppShell. Di bawah ini selalu Klasik.
export const DESKTOP_MIN_WIDTH = 1024;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

// Daftar tab yang bisa dibuka sebagai jendela di mode Desktop (Windows/Mac). Saat ini SEMUA tab operasional berjendela
// (kelompok: Dashboard/POS/Pesanan/Produk/Kategori/Reseller/Pelanggan, Dompet/Pemasukan/Pengeluaran, Mitra dan Titip Jual/Lapak,
// pengadaan/Gudang/Produksi, laporan, Pengaturan, Pengguna/Role/Izin Role/Modul/Menu, Riwayat, Notifikasi, Biaya Admin).
// Menambah id di sini wajib disertai: cabang di renderTab (page.tsx), ukuran awal/minimum di window-reducer.ts, dan tes
// pemetaan di ui-layout.test.ts. Id yang tidak ada di daftar ini dibuka sementara lewat kerangka Klasik (chip "Kembali ke
// mode Desktop"). Catatan per tab (sub-tab di dalam tab, state level page, penyegaran data) ada di tes dan komentar tab itu.
export const WINDOW_TABS = ['dashboard', 'orders', 'products', 'wallets', 'income', 'expenses', 'pos', 'consignment', 'wa-forward', 'mitra-report', 'finance-report', 'suppliers', 'materials', 'purchase-orders', 'goods-receipts',
  'stock', 'production', 'product-report', 'capital', 'po-report', 'gr-report', 'opname-report', 'stock-report', 'stall-report', 'settings', 'users', 'history', 'notifications', 'categories', 'resellers', 'customers', 'storefront-customers', 'reviews', 'admin-fee', 'tagihan-admin-fee', 'roles', 'consign', 'consign-opname', 'consign-journal', 'stall-own', 'stall-sales-report', 'stall-pos', 'role-permissions', 'modules', 'menus'] as const;
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
  writeLastLayout(layout, storage);
}

// Layout terakhir yang dipakai di perangkat ini, TANPA bergantung username: username baru diketahui setelah /api/me selesai,
// sedangkan layar "memuat" sudah tampil sebelum itu. Hanya dipakai menebak tampilan splash; server tetap sumber kebenaran.
export const LAST_LAYOUT_KEY = 'ui-layout:last';

export function readLastLayout(storage: StorageLike | null = defaultStorage()): UiLayout | null {
  try {
    const raw = storage?.getItem(LAST_LAYOUT_KEY);
    return isUiLayout(raw) ? raw : null;
  } catch { return null; }
}

export function writeLastLayout(layout: UiLayout, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(LAST_LAYOUT_KEY, layout); } catch { /* abaikan */ }
}

// Skin untuk splash bertema Desktop saat memuat; null = tampilan memuat biasa (Klasik, layar sempit, atau belum login).
export function resolveBootSkin(o: { last: UiLayout | null; hasSession: boolean; isWide: boolean }): 'windows' | 'mac' | null {
  if (!o.hasSession || !o.isWide) return null;
  return o.last === 'windows' || o.last === 'mac' ? o.last : null;
}

// Server menang bila ada nilai valid; bila server tidak mengembalikan (kolom belum ada / DB sesaat
// bermasalah) pakai cache perangkat; terakhir Klasik.
export function resolveLayout(server: unknown, cached: UiLayout | null): UiLayout {
  if (isUiLayout(server)) return server;
  return cached ?? DEFAULT_LAYOUT;
}
