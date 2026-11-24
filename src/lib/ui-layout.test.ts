import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT, DESKTOP_SHORTCUT_TABS, isShortcutTab, LAST_LAYOUT_KEY, readLastLayout, resolveBootSkin, writeLastLayout, WINDOW_TABS, isDesktopShown, isUiLayout, isWindowTab, layoutStorageKey, parseLayout,
  readCachedLayout, resolveLayout, writeCachedLayout,
} from './ui-layout';

const fakeStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

describe('parseLayout', () => {
  it('nilai valid dipertahankan', () => {
    expect(parseLayout('classic')).toBe('classic');
    expect(parseLayout('windows')).toBe('windows');
    expect(parseLayout('mac')).toBe('mac');
  });
  it('nilai tak dikenal / kosong jatuh ke classic', () => {
    for (const v of [null, undefined, '', 'Windows', 'linux', 1, {}, []]) expect(parseLayout(v)).toBe(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT).toBe('classic');
  });
  it('isUiLayout menolak non-string', () => {
    expect(isUiLayout('mac')).toBe(true);
    expect(isUiLayout(null)).toBe(false);
    expect(isUiLayout('MAC')).toBe(false);
  });
});

describe('isDesktopShown', () => {
  it('classic tidak pernah menampilkan desktop', () => {
    for (const t of WINDOW_TABS) expect(isDesktopShown('classic', true, t)).toBe(false);
  });
  it('di bawah lg selalu klasik', () => {
    expect(isDesktopShown('windows', false, 'dashboard')).toBe(false);
    expect(isDesktopShown('mac', false, 'orders')).toBe(false);
  });
  it('hanya menu berjendela yang tampil sebagai desktop', () => {
    expect(isDesktopShown('mac', true, 'orders')).toBe(true);
    expect(isDesktopShown('windows', true, 'modules')).toBe(false);
    expect(isWindowTab('pos')).toBe(true);
    expect(isWindowTab('modules')).toBe(false);
  });
});

describe('cache layout', () => {
  it('kunci per username', () => {
    expect(layoutStorageKey('rifal')).not.toBe(layoutStorageKey('lain'));
  });
  it('tulis lalu baca; nilai rusak diabaikan', () => {
    const s = fakeStorage();
    expect(readCachedLayout('a', s)).toBeNull();
    writeCachedLayout('a', 'mac', s);
    expect(readCachedLayout('a', s)).toBe('mac');
    expect(readCachedLayout('b', s)).toBeNull();
    s.m.set(layoutStorageKey('a'), 'ngawur');
    expect(readCachedLayout('a', s)).toBeNull();
  });
  it('storage yang melempar tidak merusak', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readCachedLayout('a', bad)).toBeNull();
    expect(() => writeCachedLayout('a', 'mac', bad)).not.toThrow();
    expect(readCachedLayout('a', null)).toBeNull();
  });
});

describe('resolveLayout', () => {
  it('server menang, lalu cache, lalu classic', () => {
    expect(resolveLayout('windows', 'mac')).toBe('windows');
    expect(resolveLayout(null, 'mac')).toBe('mac');
    expect(resolveLayout('ngawur', 'mac')).toBe('mac');
    expect(resolveLayout(null, null)).toBe('classic');
  });
});

describe('pemetaan WINDOW_TABS tahap 3 (Mitra)', () => {
  it('keluarga Mitra yang berdiri sendiri berjendela; Titip Jual/Lapak belum', () => {
    for (const t of ['consignment', 'wa-forward', 'mitra-report', 'pos']) expect(isWindowTab(t)).toBe(true);
    for (const t of ['modules']) expect(isWindowTab(t)).toBe(false);
  });
  it('tautan notifikasi consignment_* ("consignment") membuka mode Desktop; tautan Titip Jual ("consign") memakai Klasik sementara', () => {
    expect(isDesktopShown('windows', true, 'consignment')).toBe(true);
    expect(isDesktopShown('mac', true, 'modules')).toBe(false);
  });
  it('pintasan meja/dock adalah himpunan bagian WINDOW_TABS dan tidak memuat semua menu', () => {
    for (const t of DESKTOP_SHORTCUT_TABS) expect(isWindowTab(t)).toBe(true);
    expect(isShortcutTab('consignment')).toBe(true);
    expect(isShortcutTab('wa-forward')).toBe(false);
    expect(isShortcutTab('mitra-report')).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 4 (Laporan Keuangan)', () => {
  it('finance-report berjendela, laporan lain belum, dan bukan pintasan meja/dock', () => {
    expect(isWindowTab('finance-report')).toBe(true);
    for (const t of ['modules', 'menus']) expect(isWindowTab(t)).toBe(false);
    expect(isShortcutTab('finance-report')).toBe(false);
    expect(isDesktopShown('mac', true, 'finance-report')).toBe(true);
  });
});

describe('cache layout terakhir (tanpa username) dan skin splash', () => {
  it('writeCachedLayout juga mengisi "last"; read/write last tahan storage rusak', () => {
    const s = fakeStorage();
    expect(readLastLayout(s)).toBeNull();
    writeCachedLayout('a', 'mac', s);
    expect(readLastLayout(s)).toBe('mac');
    writeLastLayout('classic', s);
    expect(readLastLayout(s)).toBe('classic');
    s.m.set(LAST_LAYOUT_KEY, 'ngawur');
    expect(readLastLayout(s)).toBeNull();
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readLastLayout(bad)).toBeNull();
    expect(() => writeLastLayout('mac', bad)).not.toThrow();
    expect(readLastLayout(null)).toBeNull();
  });
  it('resolveBootSkin: splash Desktop hanya bila ada sesi, layar lebar, dan layout terakhir windows/mac', () => {
    expect(resolveBootSkin({ last: 'windows', hasSession: true, isWide: true })).toBe('windows');
    expect(resolveBootSkin({ last: 'mac', hasSession: true, isWide: true })).toBe('mac');
    expect(resolveBootSkin({ last: 'classic', hasSession: true, isWide: true })).toBeNull();
    expect(resolveBootSkin({ last: null, hasSession: true, isWide: true })).toBeNull();
    expect(resolveBootSkin({ last: 'mac', hasSession: false, isWide: true })).toBeNull();
    expect(resolveBootSkin({ last: 'mac', hasSession: true, isWide: false })).toBeNull();
  });
});

describe('pemetaan WINDOW_TABS tahap 5 (Supplier / pengadaan)', () => {
  it('suppliers, materials, PO, GR berjendela; Pengaturan/Pengguna belum; tidak jadi pintasan', () => {
    for (const t of ['suppliers', 'materials', 'purchase-orders', 'goods-receipts']) {
      expect(isWindowTab(t)).toBe(true);
      expect(isShortcutTab(t)).toBe(false);
    }
    for (const t of ['modules']) expect(isWindowTab(t)).toBe(false);
    expect(isDesktopShown('windows', true, 'materials')).toBe(true);
  });
});

describe('pemetaan WINDOW_TABS tahap 6 (Gudang, Produksi, Laporan)', () => {
  it('gudang, produksi, dan laporan murni berjendela dan bukan pintasan; Lapak/Pengaturan/Administrasi tetap non-jendela', () => {
    for (const t of ['stock', 'production', 'product-report', 'capital', 'po-report', 'gr-report', 'opname-report', 'stock-report', 'stall-report']) {
      expect(isWindowTab(t), t).toBe(true);
      expect(isShortcutTab(t), t).toBe(false);
    }
    for (const t of ['modules', 'menus', 'role-permissions']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 7 (Pengaturan)', () => {
  it('settings berjendela dan bukan pintasan; Kategori/Reseller/Pelanggan/Ulasan dan administrasi tetap non-jendela', () => {
    expect(isWindowTab('settings')).toBe(true);
    expect(isShortcutTab('settings')).toBe(false);
    for (const t of ['modules', 'menus', 'role-permissions']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 8 (Pengguna)', () => {
  it('users berjendela dan bukan pintasan; roles/role-permissions/modules/menus (struktur akses dan navigasi) tetap non-jendela', () => {
    expect(isWindowTab('users')).toBe(true);
    expect(isShortcutTab('users')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 9 (Riwayat)', () => {
  it('history berjendela dan bukan pintasan; Notifikasi, Admin Fee, Role/Izin/Modul/Menu, Titip Jual tetap non-jendela', () => {
    expect(isWindowTab('history')).toBe(true);
    expect(isShortcutTab('history')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 10 (Notifikasi)', () => {
  it('notifications berjendela dan bukan pintasan; Admin Fee, Role/Izin/Modul/Menu, Titip Jual tetap non-jendela', () => {
    expect(isWindowTab('notifications')).toBe(true);
    expect(isShortcutTab('notifications')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 11 (Kategori)', () => {
  it('categories berjendela dan bukan pintasan; Reseller/Pelanggan/Ulasan, Admin Fee, Role/Izin/Modul/Menu, Titip Jual tetap non-jendela', () => {
    expect(isWindowTab('categories')).toBe(true);
    expect(isShortcutTab('categories')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 13 (Reseller)', () => {
  it('resellers berjendela dan bukan pintasan; Pelanggan, Pelanggan Storefront, Ulasan, Admin Fee, Role/Izin/Modul/Menu, Titip Jual tetap non-jendela', () => {
    expect(isWindowTab('resellers')).toBe(true);
    expect(isShortcutTab('resellers')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 14 (Pelanggan)', () => {
  it('customers berjendela dan bukan pintasan; Pelanggan Storefront, Ulasan, Admin Fee, Role/Izin/Modul/Menu, Titip Jual tetap non-jendela', () => {
    expect(isWindowTab('customers')).toBe(true);
    expect(isShortcutTab('customers')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 16 (Storefront, Ulasan, Biaya Admin)', () => {
  it('berjendela dan bukan pintasan; Role/Izin/Modul/Menu dan Titip Jual/Lapak tetap non-jendela', () => {
    for (const t of ['storefront-customers', 'reviews', 'admin-fee', 'tagihan-admin-fee']) {
      expect(isWindowTab(t), t).toBe(true);
      expect(isShortcutTab(t), t).toBe(false);
    }
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 17 (Role)', () => {
  it('roles berjendela dan bukan pintasan; Izin Role, Modul, Menu, Titip Jual tetap non-jendela', () => {
    expect(isWindowTab('roles')).toBe(true);
    expect(isShortcutTab('roles')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 18 (Titip Jual)', () => {
  it('consign berjendela dan bukan pintasan; sisa keluarga Lapak dan Role/Modul/Menu tetap non-jendela', () => {
    expect(isWindowTab('consign')).toBe(true);
    expect(isShortcutTab('consign')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
  it("tautan notifikasi stok titipan menipis ('consign') membuka jendela; tombol 'Buka jurnal' (consign-journal, tahap 20) kini membuka jendela Dompet Lapak; ke tab non-jendela (modules) memakai kerangka Klasik sementara", () => {
    expect(isDesktopShown('windows', true, 'consign')).toBe(true);
    expect(isDesktopShown('mac', true, 'consign-journal')).toBe(true);
    expect(isDesktopShown('mac', true, 'modules')).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 19 (Opname Titipan)', () => {
  it('consign-opname berjendela dan bukan pintasan; Dompet Lapak, Produk Toko, Kasir Lapak, Role/Modul/Menu tetap non-jendela', () => {
    expect(isWindowTab('consign-opname')).toBe(true);
    expect(isShortcutTab('consign-opname')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 20 (Dompet Lapak)', () => {
  it('consign-journal berjendela dan bukan pintasan; Kasir Lapak, Izin Role, Modul, Menu tetap non-jendela', () => {
    expect(isWindowTab('consign-journal')).toBe(true);
    expect(isShortcutTab('consign-journal')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 21 (Produk Toko di Lapak, Laporan Kasir Lapak)', () => {
  it('stall-own dan stall-sales-report berjendela dan bukan pintasan; Kasir Lapak, Izin Role, Modul, Menu tetap non-jendela', () => {
    for (const t of ['stall-own', 'stall-sales-report']) {
      expect(isWindowTab(t), t).toBe(true);
      expect(isShortcutTab(t), t).toBe(false);
      expect(isDesktopShown('windows', true, t), t).toBe(true);
      expect(isDesktopShown('mac', false, t), t).toBe(false);
      expect(isDesktopShown('classic', true, t), t).toBe(false);
    }
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});

describe('pemetaan WINDOW_TABS tahap 22 (Kasir Lapak)', () => {
  it('stall-pos berjendela dan bukan pintasan; Izin Role, Modul, Menu tetap non-jendela', () => {
    expect(isWindowTab('stall-pos')).toBe(true);
    expect(isShortcutTab('stall-pos')).toBe(false);
    for (const t of ['role-permissions', 'modules', 'menus']) expect(isWindowTab(t), t).toBe(false);
  });
});
