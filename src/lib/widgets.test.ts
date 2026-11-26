import { describe, expect, it } from 'vitest';
import {
  MAX_WIDGETS, WIDGET_SPECS, newWidgetId, normalizeWidgets, parseStrictWidgets, parseWidgets, readCachedWidgets,
  resolveWidgets, sameWidgets, widgetsStorageKey, writeCachedWidgets, type WidgetInstance,
} from './widgets';

const clock: WidgetInstance = { id: 'abcd1234', type: 'clock', col: 0, row: 0, size: 's', config: {} };
const note: WidgetInstance = { id: 'efgh5678', type: 'note', col: 2, row: 0, size: 'm', config: { text: 'hai' } };

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

describe('spec type', () => {
  it('config bawaan lolos validasi ketat tiap type; ukuran bawaan termasuk yang diizinkan', () => {
    for (const [t, s] of Object.entries(WIDGET_SPECS)) {
      expect(s.strictConfig(s.defaultConfig), t).toEqual(s.defaultConfig);
      expect(s.allowedSizes).toContain(s.defaultSize);
    }
  });
  it('cleanConfig toleran: membuang kunci asing, memotong catatan, membuang karakter kontrol', () => {
    expect(WIDGET_SPECS.note.cleanConfig({ text: 'a'.repeat(900), x: 1 })).toEqual({ text: 'a'.repeat(500) });
    expect(WIDGET_SPECS.note.cleanConfig({ text: 'a\u0000b\nc' })).toEqual({ text: 'ab\nc' });
    expect(WIDGET_SPECS.note.cleanConfig('x')).toEqual({ text: '' });
    expect(WIDGET_SPECS.clock.cleanConfig({ format: 'hms', z: 1 })).toEqual({ format: 'hms' });
    expect(WIDGET_SPECS.clock.cleanConfig({ format: 'zzz' })).toEqual({});
  });
});

describe('parseStrictWidgets', () => {
  it('menerima daftar valid sebagai salinan bersih', () => {
    const out = parseStrictWidgets([clock, note]);
    expect(out).toEqual([clock, note]);
    expect(out![0]).not.toBe(clock);
  });
  it('maksimum 12', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ...clock, id: `w${i}` }));
    expect(parseStrictWidgets(mk(MAX_WIDGETS))).toHaveLength(MAX_WIDGETS);
    expect(parseStrictWidgets(mk(MAX_WIDGETS + 1))).toBeNull();
  });
  it('menolak yang tidak valid', () => {
    expect(parseStrictWidgets('x')).toBeNull();
    expect(parseStrictWidgets([{ ...clock, size: 'l' }])).toBeNull();
    expect(parseStrictWidgets([clock, clock])).toBeNull();
    expect(parseStrictWidgets([{ ...clock, col: 40 }])).toBeNull();
    expect(parseStrictWidgets([{ ...note, config: { text: 'x'.repeat(501) } }])).toBeNull();
  });
});

describe('parseWidgets (toleran)', () => {
  it('[] tetap [], non-array/rusak null', () => {
    expect(parseWidgets([])).toEqual([]);
    expect(parseWidgets(null)).toBeNull();
    expect(parseWidgets({})).toBeNull();
    expect(parseWidgets('{rusak')).toBeNull();
    expect(parseWidgets(5)).toBeNull();
  });
  it('string mentah dan terenkode ganda', () => {
    expect(parseWidgets(JSON.stringify([clock]))).toEqual([clock]);
    expect(parseWidgets(JSON.stringify(JSON.stringify([clock])))).toEqual([clock]);
  });
  it('membuang item rusak/duplikat/tak dikenal; memperbaiki ukuran dan koordinat buruk', () => {
    const out = parseWidgets([clock, clock, { id: 'x', type: 'tidak-ada' }, 7, { ...note, size: 'x', col: -3, row: 99, config: { text: 5 } }]);
    expect(out).toEqual([clock, { ...note, size: 'm', col: 0, row: 0, config: { text: '' } }]);
  });
  it('dibatasi 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...clock, id: `w${i}` }));
    expect(parseWidgets(many)).toHaveLength(MAX_WIDGETS);
  });
});

describe('normalizeWidgets', () => {
  it('buang duplikat id dan type tak dikenal, batasi 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...clock, id: `w${i}` }));
    expect(normalizeWidgets([clock, clock, { ...note, type: 'x' }, note])).toEqual([clock, note]);
    expect(normalizeWidgets(many)).toHaveLength(MAX_WIDGETS);
  });
});

describe('cache perangkat', () => {
  it('tulis/baca per username; null menghapus isi', () => {
    const st = memStorage();
    writeCachedWidgets('u', [clock], st);
    expect(readCachedWidgets('u', st)).toEqual([clock]);
    writeCachedWidgets('u', [], st);
    expect(readCachedWidgets('u', st)).toEqual([]);
    writeCachedWidgets('u', null, st);
    expect(readCachedWidgets('u', st)).toBeNull();
    expect(st.m.get(widgetsStorageKey('u'))).toBe('');
  });
  it('storage rusak/melempar -> null tanpa melempar', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readCachedWidgets('u', bad)).toBeNull();
    expect(() => writeCachedWidgets('u', [clock], bad)).not.toThrow();
    expect(readCachedWidgets('u', memStorage({ [widgetsStorageKey('u')]: '{bukan' }))).toBeNull();
  });
  it('resolveWidgets: server (termasuk []) menang, lalu cache, lalu null', () => {
    expect(resolveWidgets([clock], [note])).toEqual([clock]);
    expect(resolveWidgets([], [note])).toEqual([]);
    expect(resolveWidgets(null, [note])).toEqual([note]);
    expect(resolveWidgets('rusak{', null)).toBeNull();
  });
});

describe('util', () => {
  it('newWidgetId 8 karakter alfanumerik', () => { expect(newWidgetId()).toMatch(/^[a-z0-9]{8}$/); });
  it('sameWidgets', () => { expect(sameWidgets([clock], [{ ...clock }])).toBe(true); expect(sameWidgets([clock], null)).toBe(false); expect(sameWidgets(null, null)).toBe(true); });
});
