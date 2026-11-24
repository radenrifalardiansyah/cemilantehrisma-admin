import { describe, expect, it } from 'vitest';
import {
  ACCENTS, DEFAULT_APPEARANCE, LAST_APPEARANCE_KEY, appearanceStorageKey, parseAppearance, parseStrictAppearance, readCachedAppearance,
  readLastAppearance, resolveAppearance, sameAppearance, writeCachedAppearance, type Appearance,
} from './appearance';

const fakeStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};
const full: Appearance = { accent: 'blue', wallpaper: 'waves', density: 'compact', textSize: 'large' };

describe('parseAppearance', () => {
  it('nilai valid dipertahankan', () => expect(parseAppearance(full)).toEqual(full));
  it('data rusak / bukan objek -> default', () => {
    for (const v of [null, undefined, 1, 'x', [], '{', true]) expect(parseAppearance(v)).toEqual(DEFAULT_APPEARANCE);
  });
  it('partial di-merge dengan default; field tak dikenal diabaikan; id tak valid -> default field itu', () => {
    expect(parseAppearance({ accent: 'rose', foo: 1 })).toEqual({ ...DEFAULT_APPEARANCE, accent: 'rose' });
    expect(parseAppearance({ accent: 'neon', wallpaper: 'waves', density: 5, textSize: null })).toEqual({ ...DEFAULT_APPEARANCE, wallpaper: 'waves' });
  });
  it('string JSON diterima', () => expect(parseAppearance(JSON.stringify(full))).toEqual(full));
});

describe('parseStrictAppearance', () => {
  it('objek lengkap valid diterima', () => expect(parseStrictAppearance(full)).toEqual(full));
  it('menolak partial, field asing, id tak dikenal, non-objek', () => {
    expect(parseStrictAppearance({ accent: 'blue' })).toBeNull();
    expect(parseStrictAppearance({ ...full, extra: 1 })).toBeNull();
    expect(parseStrictAppearance({ ...full, accent: 'neon' })).toBeNull();
    expect(parseStrictAppearance({ ...full, density: 'huge' })).toBeNull();
    for (const v of [null, undefined, 'x', [], 1]) expect(parseStrictAppearance(v)).toBeNull();
  });
  it('setiap accent dikenal diterima', () => { for (const a of ACCENTS) expect(parseStrictAppearance({ ...full, accent: a })).not.toBeNull(); });
});

describe('cache dan resolusi', () => {
  it('tulis per username juga mengisi "last"; baca; rusak diabaikan', () => {
    const s = fakeStorage();
    expect(readCachedAppearance('a', s)).toBeNull();
    writeCachedAppearance('a', full, s);
    expect(readCachedAppearance('a', s)).toEqual(full);
    expect(readCachedAppearance('b', s)).toBeNull();
    expect(readLastAppearance(s)).toEqual(full);
    s.m.set(appearanceStorageKey('a'), '{rusak');
    expect(readCachedAppearance('a', s)).toEqual(DEFAULT_APPEARANCE);   // parse aman: default, bukan crash
    s.m.set(LAST_APPEARANCE_KEY, '');
    expect(readLastAppearance(s)).toBeNull();
  });
  it('storage yang melempar tidak merusak', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readCachedAppearance('a', bad)).toBeNull();
    expect(() => writeCachedAppearance('a', full, bad)).not.toThrow();
    expect(readLastAppearance(null)).toBeNull();
  });
  it('server (objek) menang, lalu cache, lalu default', () => {
    expect(resolveAppearance(full, { ...full, accent: 'rose' })).toEqual(full);
    expect(resolveAppearance(null, { ...full, accent: 'rose' })).toEqual({ ...full, accent: 'rose' });
    expect(resolveAppearance(null, null)).toEqual(DEFAULT_APPEARANCE);
  });
  it('sameAppearance', () => {
    expect(sameAppearance(full, { ...full })).toBe(true);
    expect(sameAppearance(full, { ...full, textSize: 'small' })).toBe(false);
  });
});
