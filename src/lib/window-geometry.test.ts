import { describe, expect, it } from 'vitest';
import { GEOMETRY_MAX_ENTRIES, geometryKey, isValidRect, readGeometry, sanitizeGeometry, setGeometryEntry, writeGeometry } from './window-geometry';

const mem = (init: Record<string, string> = {}) => {
  const d = { ...init };
  return { getItem: (k: string) => d[k] ?? null, setItem: (k: string, v: string) => { d[k] = v; }, d };
};
const R = { x: 10, y: 20, w: 800, h: 500 };

describe('geometryKey', () => {
  it('per pengguna dan skin', () => {
    expect(geometryKey('rifal', 'mac')).toBe('ui-window-geometry:rifal:mac');
    expect(geometryKey('rifal', 'windows')).not.toBe(geometryKey('rifal', 'mac'));
    expect(geometryKey('a', 'mac')).not.toBe(geometryKey('b', 'mac'));
  });
});

describe('isValidRect', () => {
  it('menerima rect wajar, termasuk koordinat negatif sebagian', () => {
    expect(isValidRect(R)).toBe(true);
    expect(isValidRect({ ...R, x: -300 })).toBe(true);
  });
  it('menolak bukan objek, NaN/Infinity, string, ukuran terlalu kecil/besar, koordinat gila', () => {
    for (const bad of [null, undefined, 5, 'x', [], { x: 1 }, { ...R, w: NaN }, { ...R, h: Infinity }, { ...R, x: '1' }, { ...R, w: 50 }, { ...R, h: 50 }, { ...R, w: 99999 }, { ...R, x: 99999 }, { ...R, y: -99999 }]) {
      expect(isValidRect(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('sanitizeGeometry', () => {
  it('membuang entri rusak dan id tak dikenal, membulatkan angka', () => {
    const out = sanitizeGeometry({ pos: { x: 1.4, y: 2.6, w: 800.2, h: 500.7 }, hantu: R, rusak: { x: 'a' } }, id => id !== 'hantu');
    expect(out).toEqual({ pos: { x: 1, y: 3, w: 800, h: 501 } });
  });
  it('bukan objek / array / null menghasilkan kosong', () => {
    for (const bad of [null, undefined, 3, 'x', [R], true]) expect(sanitizeGeometry(bad)).toEqual({});
  });
  it('dibatasi GEOMETRY_MAX_ENTRIES, entri terbaru (paling akhir) dipertahankan', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < GEOMETRY_MAX_ENTRIES + 10; i++) big[`t${i}`] = R;
    const out = sanitizeGeometry(big);
    expect(Object.keys(out)).toHaveLength(GEOMETRY_MAX_ENTRIES);
    expect(out.t0).toBeUndefined();
    expect(out[`t${GEOMETRY_MAX_ENTRIES + 9}`]).toBeDefined();
  });
});

describe('readGeometry / writeGeometry', () => {
  it('tulis lalu baca kembali; pemisahan per skin dan pengguna', () => {
    const s = mem();
    writeGeometry('rifal', 'windows', { pos: R }, s);
    expect(readGeometry('rifal', 'windows', undefined, s)).toEqual({ pos: R });
    expect(readGeometry('rifal', 'mac', undefined, s)).toEqual({});
    expect(readGeometry('lain', 'windows', undefined, s)).toEqual({});
  });
  it('JSON rusak / bukan objek / storage melempar / storage null: aman, hasil kosong', () => {
    expect(readGeometry('u', 'mac', undefined, mem({ [geometryKey('u', 'mac')]: '{rusak' }))).toEqual({});
    expect(readGeometry('u', 'mac', undefined, mem({ [geometryKey('u', 'mac')]: '"teks"' }))).toEqual({});
    expect(readGeometry('u', 'mac', undefined, { getItem: () => { throw new Error('x'); }, setItem: () => {} })).toEqual({});
    expect(readGeometry('u', 'mac', undefined, null)).toEqual({});
    expect(() => writeGeometry('u', 'mac', { pos: R }, { getItem: () => null, setItem: () => { throw new Error('penuh'); } })).not.toThrow();
    expect(() => writeGeometry('u', 'mac', { pos: R }, null)).not.toThrow();
  });
  it('tanpa username: tidak membaca dan tidak menulis', () => {
    const s = mem();
    writeGeometry('', 'mac', { pos: R }, s);
    expect(Object.keys(s.d)).toHaveLength(0);
    expect(readGeometry('', 'mac', undefined, mem({ [geometryKey('', 'mac')]: JSON.stringify({ pos: R }) }))).toEqual({});
  });
  it('membersihkan id yang tidak dikenal saat dibaca', () => {
    const s = mem({ [geometryKey('u', 'mac')]: JSON.stringify({ pos: R, hantu: R }) });
    expect(readGeometry('u', 'mac', id => id === 'pos', s)).toEqual({ pos: R });
  });
});

describe('setGeometryEntry', () => {
  it('menambah tanpa mengubah peta asal dan menaruh entri terbaru di akhir', () => {
    const base = { a: R, b: R };
    const next = setGeometryEntry(base, 'a', { ...R, x: 99 });
    expect(base.a.x).toBe(10);
    expect(Object.keys(next)).toEqual(['b', 'a']);
    expect(next.a.x).toBe(99);
  });
  it('rect tidak valid diabaikan', () => {
    const base = { a: R };
    expect(setGeometryEntry(base, 'b', { ...R, w: NaN })).toBe(base);
  });
});
