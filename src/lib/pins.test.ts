import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PINS, LAST_PINS_KEY, MAX_PINS, effectivePins, parsePins, parseStrictPins, pinsStorageKey, readCachedPins, readLastPins, resolvePins, samePins, togglePin, writeCachedPins,
} from './pins';
import { DESKTOP_SHORTCUT_TABS, WINDOW_TABS } from './ui-layout';

const fakeStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

describe('parsePins (toleran)', () => {
  it('array valid dipertahankan berurutan; kosong tetap kosong (bukan null)', () => {
    expect(parsePins(['orders', 'dashboard'])).toEqual(['orders', 'dashboard']);
    expect(parsePins([])).toEqual([]);
  });
  it('rusak/bukan array -> null; string JSON mentah dan terenkode ganda diurai', () => {
    for (const v of [null, undefined, 1, {}, 'x', '{', true]) expect(parsePins(v)).toBeNull();
    expect(parsePins(JSON.stringify(['orders']))).toEqual(['orders']);
    expect(parsePins(JSON.stringify(JSON.stringify(['orders'])))).toEqual(['orders']);
  });
  it('id tak dikenal/duplikat/non-string dibuang tanpa membatalkan sisanya', () => {
    expect(parsePins(['orders', 'bukan-tab', 5, 'orders', 'dashboard'])).toEqual(['orders', 'dashboard']);
  });
});

describe('parseStrictPins (PUT)', () => {
  it('valid diterima', () => expect(parseStrictPins(['orders', 'dashboard'])).toEqual(['orders', 'dashboard']));
  it('menolak non-array, id tak dikenal, duplikat, tipe salah, dan terlalu panjang', () => {
    expect(parseStrictPins('orders')).toBeNull();
    expect(parseStrictPins(['bukan-tab'])).toBeNull();
    expect(parseStrictPins(['orders', 'orders'])).toBeNull();
    expect(parseStrictPins(['orders', 3])).toBeNull();
    expect(parseStrictPins(Array.from({ length: MAX_PINS + 1 }, (_, i) => `x${i}`))).toBeNull();
  });
  it('semua tab berjendela boleh disematkan (maks 40)', () => {
    expect(parseStrictPins(WINDOW_TABS.slice(0, MAX_PINS))).not.toBeNull();
  });
});

describe('efektif, toggle, urutan', () => {
  it('belum memilih (null) = pintasan bawaan', () => {
    expect(effectivePins(null)).toEqual(DESKTOP_SHORTCUT_TABS);
    expect(DEFAULT_PINS).toEqual(DESKTOP_SHORTCUT_TABS);
  });
  it('toggle pertama dimulai dari bawaan: lepas menghapus, sematkan menambah di akhir (urutan = urutan disematkan)', () => {
    expect(togglePin(null, 'dashboard')).toEqual(DESKTOP_SHORTCUT_TABS.filter(t => t !== 'dashboard'));
    expect(togglePin(null, 'users')).toEqual([...DESKTOP_SHORTCUT_TABS, 'users']);
    expect(togglePin(['orders'], 'users')).toEqual(['orders', 'users']);
    expect(togglePin(['orders', 'users'], 'orders')).toEqual(['users']);
  });
  it('samePins', () => {
    expect(samePins(null, null)).toBe(true);
    expect(samePins(['a'], ['a'])).toBe(true);
    expect(samePins(['a'], null)).toBe(false);
    expect(samePins(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

describe('cache dan resolusi', () => {
  it('tulis per username juga mengisi last; baca; kosong ("") dibaca sebagai null (bawaan)', () => {
    const s = fakeStorage();
    expect(readCachedPins('a', s)).toBeNull();
    writeCachedPins('a', ['orders'], s);
    expect(readCachedPins('a', s)).toEqual(['orders']);
    expect(readCachedPins('b', s)).toBeNull();
    expect(readLastPins(s)).toEqual(['orders']);
    writeCachedPins('a', null, s);
    expect(readCachedPins('a', s)).toBeNull();
    s.m.set(pinsStorageKey('a'), '{rusak');
    expect(readCachedPins('a', s)).toBeNull();
    expect(s.m.has(LAST_PINS_KEY)).toBe(true);
  });
  it('storage yang melempar tidak merusak', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readCachedPins('a', bad)).toBeNull();
    expect(() => writeCachedPins('a', ['orders'], bad)).not.toThrow();
  });
  it('server menang (termasuk daftar kosong), lalu cache, lalu null', () => {
    expect(resolvePins(['orders'], ['users'])).toEqual(['orders']);
    expect(resolvePins([], ['users'])).toEqual([]);
    expect(resolvePins(null, ['users'])).toEqual(['users']);
    expect(resolvePins(null, null)).toBeNull();
  });
});
