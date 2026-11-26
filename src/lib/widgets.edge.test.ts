import { describe, expect, it } from 'vitest';
import { MAX_CONFIG_JSON, MAX_NOTE_CHARS, parseStrictWidgets, parseWidgets, type WidgetInstance } from './widgets';
import { addWidget, fitToGrid, gridDims, moveWidget, nudgeWidget, resizeWidget } from './widget-layout';

const note = (text: string): unknown => ({ id: 'abcd1234', type: 'note', col: 0, row: 0, size: 'm', config: { text } });

// Aisha (QA): kasus tepi di luar widgets.test.ts / widget-layout.test.ts.
describe('MAX_CONFIG_JSON: catatan 500 karakter dengan escape JSON terburuk tetap diterima', () => {
  it.each([['tanda kutip', '"'], ['garis miring terbalik', '\\'], ['baris baru', '\n'], ['CR', '\r'], ['tab', '\t']])('500 x %s', (_n, ch) => {
    const text = ch.repeat(MAX_NOTE_CHARS);
    expect(JSON.stringify({ text }).length).toBeLessThanOrEqual(MAX_CONFIG_JSON);
    expect(parseStrictWidgets([note(text)])).not.toBeNull();
  });
  it('501 karakter ditolak; karakter kontrol selain tab/baris baru/CR ditolak (termasuk DEL dan U+001F)', () => {
    expect(parseStrictWidgets([note('a'.repeat(501))])).toBeNull();
    for (const c of ['\u0000', '\u0008', '\u000B', '\u000C', '\u001F', '\u007F']) expect(parseStrictWidgets([note(`a${c}b`)])).toBeNull();
  });
  it('teks HTML/skrip diterima apa adanya sebagai teks (tidak diubah, tidak ditafsirkan)', () => {
    const t = '<img src=x onerror=alert(1)><script>1</script>';
    expect(parseStrictWidgets([note(t)])![0].config).toEqual({ text: t });
  });
});

describe('parseWidgets: data jsonb aneh', () => {
  it('item dengan col/row/size/config rusak diperbaiki, bukan membuang daftar; array bersarang dan primitif dibuang', () => {
    const raw = [[], 5, null, 'x', { id: 'okok0001', type: 'note', col: -3, row: 'a', size: 'zz', config: { text: 7, evil: 1 } }];
    expect(parseWidgets(raw)).toEqual([{ id: 'okok0001', type: 'note', col: 0, row: 0, size: 'm', config: { text: '' } }]);
  });
  it('type prototipe (toString/__proto__/constructor) dibuang', () => {
    for (const t of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) expect(parseWidgets([{ id: 'okok0001', type: t, col: 0, row: 0, size: 's' }])).toEqual([]);
  });
  it('JSON "null" dan string kosong -> null (belum memilih), "[]" -> []', () => {
    expect(parseWidgets('null')).toBeNull(); expect(parseWidgets('')).toBeNull(); expect(parseWidgets('[]')).toEqual([]);
    expect(parseWidgets(JSON.stringify(JSON.stringify([])))).toEqual([]);
  });
});

describe('layout: grid nol/sangat kecil tidak melempar dan tidak menyembunyikan data', () => {
  const list: WidgetInstance[] = [
    { id: 'a0000001', type: 'clock', col: 0, row: 0, size: 's', config: {} },
    { id: 'b0000001', type: 'note', col: 2, row: 0, size: 'm', config: { text: 'x' } },
  ];
  it('layar kecil (0 kolom/0 baris): semua null; operasi ditolak tanpa mengubah daftar', () => {
    const d = gridDims({ w: 100, h: 100, top: 28, bottom: 66 });
    expect(d).toEqual({ cols: 0, rows: 0 });
    expect([...fitToGrid(list, d.cols, d.rows).values()]).toEqual([null, null]);
    expect(moveWidget(list, 'a0000001', 1, 1, 0, 0).ok).toBe(false);
    expect(nudgeWidget(list, 'a0000001', 1, 0, 0, 0).ok).toBe(false);
    expect(resizeWidget(list, 'a0000001', 'm', 0, 0).ok).toBe(false);
    expect(addWidget(list, 'clock', 0, 0).ok).toBe(false);
  });
  it('area dengan NaN tidak melempar dan tidak menampilkan widget', () => {
    const d = gridDims({ w: NaN, h: NaN, top: 0, bottom: 48 });
    expect([...fitToGrid(list, d.cols, d.rows).values()].every(v => v === null)).toBe(true);
  });
});
