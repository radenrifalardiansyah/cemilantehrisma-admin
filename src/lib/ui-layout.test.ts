import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT, DESKTOP_SHORTCUT_TABS, isShortcutTab, WINDOW_TABS, isDesktopShown, isUiLayout, isWindowTab, layoutStorageKey, parseLayout,
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
    expect(isDesktopShown('windows', true, 'suppliers')).toBe(false);
    expect(isWindowTab('pos')).toBe(true);
    expect(isWindowTab('suppliers')).toBe(false);
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
    for (const t of ['consign', 'consign-opname', 'consign-journal', 'stall-own', 'stall-pos', 'stall-report', 'notifications']) expect(isWindowTab(t)).toBe(false);
  });
  it('tautan notifikasi consignment_* ("consignment") membuka mode Desktop; tautan Titip Jual ("consign") memakai Klasik sementara', () => {
    expect(isDesktopShown('windows', true, 'consignment')).toBe(true);
    expect(isDesktopShown('mac', true, 'consign')).toBe(false);
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
    for (const t of ['product-report', 'capital', 'stall-report']) expect(isWindowTab(t)).toBe(false);
    expect(isShortcutTab('finance-report')).toBe(false);
    expect(isDesktopShown('mac', true, 'finance-report')).toBe(true);
  });
});
