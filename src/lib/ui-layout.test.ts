import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT, WINDOW_TABS, isDesktopShown, isUiLayout, isWindowTab, layoutStorageKey, parseLayout,
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
    expect(isWindowTab('pos')).toBe(false);
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
