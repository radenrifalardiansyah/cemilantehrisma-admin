import { describe, expect, it } from 'vitest';
import {
  CELL, GAP, PAD, PITCH, addWidget, canAddWidget, canPlace, clampToGrid, findFreeSlot, fitToGrid, gridDims, moveWidget, nudgeWidget, rectsOverlap,
  resizeWidget, sizeCells, snapToCell, spanPx, widgetBox, type Rect,
} from './widget-layout';
import { AREA_INSETS } from '@/components/desktop/window-reducer';
import { MAX_WIDGETS, type WidgetInstance } from './widgets';

const W = (id: string, col: number, row: number, size: 's' | 'm' | 'l' = 's', type = 'clock'): WidgetInstance => ({ id, type, col, row, size, config: {} });
const R = (col: number, row: number, w: number, h: number): Rect => ({ col, row, w, h });

describe('konstanta dan ukuran', () => {
  it('sel 112, celah 12, pitch 124; s=2x2, m=4x2, l=4x3', () => {
    expect([CELL, GAP, PAD, PITCH]).toEqual([112, 12, 12, 124]);
    expect(sizeCells('s')).toEqual({ w: 2, h: 2 });
    expect(sizeCells('m')).toEqual({ w: 4, h: 2 });
    expect(sizeCells('l')).toEqual({ w: 4, h: 3 });
  });
  it('gridDims: memakai inset area kerja (Windows dan Mac)', () => {
    expect(gridDims({ w: 1280, h: 720, ...AREA_INSETS.windows })).toEqual({ cols: 10, rows: 5 });
    expect(gridDims({ w: 1280, h: 720, ...AREA_INSETS.mac })).toEqual({ cols: 10, rows: 4 });   // menu bar 28 + dock 66 memakan satu baris
    expect(gridDims({ w: 1920, h: 1080, ...AREA_INSETS.windows })).toEqual({ cols: 15, rows: 8 });
    expect(gridDims({ w: 100, h: 50, top: 0, bottom: 48 })).toEqual({ cols: 0, rows: 0 });
  });
  it('spanPx dan widgetBox (kolom dari kanan)', () => {
    expect(spanPx(2)).toBe(236);
    expect(widgetBox(R(0, 0, 2, 2))).toEqual({ right: 12, top: 12, width: 236, height: 236 });
    expect(widgetBox(R(2, 1, 4, 2))).toEqual({ right: 12 + 248, top: 12 + 124, width: 484, height: 236 });
  });
  it('snapToCell: kebalikan widgetBox (membulatkan ke sel terdekat)', () => {
    const layerW = 1280; const cells = sizeCells('m');
    const b = widgetBox(R(3, 2, 4, 2));
    const left = layerW - b.right - b.width;
    expect(snapToCell(left, b.top, cells, layerW)).toEqual({ col: 3, row: 2 });
    expect(snapToCell(left + 30, b.top - 20, cells, layerW)).toEqual({ col: 3 - 0, row: 2 - 0 });   // < setengah pitch: tetap
    expect(snapToCell(left - 70, b.top + 70, cells, layerW)).toEqual({ col: 4, row: 3 });
  });
});

describe('rectsOverlap / clampToGrid / canPlace', () => {
  it('overlap hanya bila area beririsan (bersentuhan tidak)', () => {
    expect(rectsOverlap(R(0, 0, 2, 2), R(1, 1, 2, 2))).toBe(true);
    expect(rectsOverlap(R(0, 0, 2, 2), R(2, 0, 2, 2))).toBe(false);
    expect(rectsOverlap(R(0, 0, 2, 2), R(0, 2, 2, 2))).toBe(false);
    expect(rectsOverlap(R(0, 0, 4, 4), R(1, 1, 1, 1))).toBe(true);
  });
  it('clampToGrid menjepit; grid lebih kecil dari rect -> 0', () => {
    expect(clampToGrid(R(9, 4, 4, 2), 10, 5)).toEqual(R(6, 3, 4, 2));
    expect(clampToGrid(R(-2, -1, 2, 2), 10, 5)).toEqual(R(0, 0, 2, 2));
    expect(clampToGrid(R(3, 3, 4, 3), 2, 2)).toEqual(R(0, 0, 4, 3));
  });
  it('canPlace: batas grid dan tabrakan', () => {
    expect(canPlace(R(0, 0, 2, 2), [], 10, 5)).toBe(true);
    expect(canPlace(R(9, 0, 2, 2), [], 10, 5)).toBe(false);
    expect(canPlace(R(0, 4, 2, 2), [], 10, 5)).toBe(false);
    expect(canPlace(R(0, 0, 2, 2), [R(1, 1, 2, 2)], 10, 5)).toBe(false);
    expect(canPlace(R(-1, 0, 2, 2), [], 10, 5)).toBe(false);
  });
});

describe('findFreeSlot', () => {
  it('urutan baris lalu kolom; melewati yang terisi', () => {
    expect(findFreeSlot({ w: 2, h: 2 }, [], 10, 5)).toEqual({ col: 0, row: 0 });
    expect(findFreeSlot({ w: 2, h: 2 }, [R(0, 0, 2, 2)], 10, 5)).toEqual({ col: 2, row: 0 });
    expect(findFreeSlot({ w: 2, h: 2 }, [R(0, 0, 4, 2), R(4, 0, 4, 2), R(8, 0, 2, 2)], 10, 5)).toEqual({ col: 0, row: 2 });
  });
  it('penuh -> null; ukuran lebih besar dari grid -> null', () => {
    expect(findFreeSlot({ w: 2, h: 2 }, [R(0, 0, 4, 4)], 4, 4)).toBeNull();
    expect(findFreeSlot({ w: 4, h: 3 }, [], 3, 5)).toBeNull();
  });
  it('dengan near: terdekat dulu; seri -> baris lalu kolom', () => {
    expect(findFreeSlot({ w: 2, h: 2 }, [R(4, 1, 2, 2)], 10, 5, { col: 4, row: 1 })).toEqual({ col: 2, row: 1 });
    expect(findFreeSlot({ w: 1, h: 1 }, [R(1, 1, 1, 1)], 3, 3, { col: 1, row: 1 })).toEqual({ col: 1, row: 0 });
  });
});

describe('fitToGrid', () => {
  it('posisi tersimpan dipertahankan bila muat', () => {
    const m = fitToGrid([W('a', 0, 0), W('b', 4, 1)], 10, 5);
    expect(m.get('a')).toEqual(R(0, 0, 2, 2)); expect(m.get('b')).toEqual(R(4, 1, 2, 2));
  });
  it('dijepit saat grid menyusut; tidak mengubah widget tersimpan; kembali di grid besar', () => {
    const ws = [W('a', 8, 3)];
    const snapshot = JSON.stringify(ws);
    expect(fitToGrid(ws, 4, 3).get('a')).toEqual(R(2, 1, 2, 2));
    expect(JSON.stringify(ws)).toBe(snapshot);
    expect(fitToGrid(ws, 10, 5).get('a')).toEqual(R(8, 3, 2, 2));
  });
  it('tabrakan akibat penjepitan: pindah ke slot bebas terdekat; tidak ada slot -> null (tersembunyi)', () => {
    const m = fitToGrid([W('a', 0, 0), W('b', 6, 0)], 4, 2);   // b dijepit ke col 2, a menempati 0-1
    expect(m.get('b')).toEqual(R(2, 0, 2, 2));
    const full = fitToGrid([W('a', 0, 0, 'm'), W('b', 0, 0, 'm')], 4, 2);
    expect(full.get('a')).toEqual(R(0, 0, 4, 2)); expect(full.get('b')).toBeNull();
  });
  it('widget lebih besar dari grid -> null', () => { expect(fitToGrid([W('a', 0, 0, 'l', 'note')], 3, 5).get('a')).toBeNull(); });
});

describe('moveWidget', () => {
  it('pindah ke sel kosong (snap) dan menyimpan posisi baru', () => {
    const r = moveWidget([W('a', 0, 0), W('b', 4, 0)], 'a', 6.4, 2.2, 10, 5);
    expect(r.ok).toBe(true);
    expect(r.widgets[0]).toMatchObject({ col: 6, row: 2 });
  });
  it('tabrakan: ditolak, daftar tidak berubah', () => {
    const ws = [W('a', 0, 0), W('b', 4, 0)];
    const r = moveWidget(ws, 'a', 3, 0, 10, 5);
    expect(r.ok).toBe(false); expect(r.widgets).toEqual(ws);
  });
  it('di luar grid dijepit (bukan ditolak); id tak ada ditolak', () => {
    expect(moveWidget([W('a', 0, 0)], 'a', 99, 99, 10, 5).widgets[0]).toMatchObject({ col: 8, row: 3 });
    expect(moveWidget([W('a', 0, 0)], 'zz', 1, 1, 10, 5).ok).toBe(false);
  });
  it('tabrakan dihitung terhadap posisi TAMPILAN widget lain (yang dijepit)', () => {
    const ws = [W('a', 0, 0), W('b', 9, 4)];                      // di grid 6x4 b tampil di (4,2)
    expect(moveWidget(ws, 'a', 4, 2, 6, 4).ok).toBe(false);
    expect(moveWidget(ws, 'a', 2, 0, 6, 4).ok).toBe(true);
  });
  it('tujuan sama dengan posisi sekarang: ok tanpa perubahan', () => {
    const r = moveWidget([W('a', 1, 1)], 'a', 1, 1, 10, 5);
    expect(r.ok).toBe(true); expect(r.widgets[0]).toMatchObject({ col: 1, row: 1 });
  });
});

describe('nudgeWidget', () => {
  it('geser satu sel; ditolak di tepi dan saat menabrak', () => {
    const ws = [W('a', 1, 0), W('b', 3, 0)];
    expect(nudgeWidget(ws, 'a', 0, 1, 10, 5).widgets[0]).toMatchObject({ col: 1, row: 1 });
    expect(nudgeWidget(ws, 'a', -2, 0, 10, 5).ok).toBe(false);          // keluar grid
    expect(nudgeWidget(ws, 'a', 1, 0, 10, 5).ok).toBe(false);           // menabrak b (col 3..4 vs a 2..3)
    expect(nudgeWidget(ws, 'a', 0, -1, 10, 5).ok).toBe(false);
  });
});

describe('resizeWidget', () => {
  const note = (id: string, col: number, row: number, size: 'm' | 'l' = 'm') => W(id, col, row, size, 'note');
  it('ukuran baru muat di tempat: posisi sama', () => {
    const r = resizeWidget([note('a', 0, 0)], 'a', 'l', 10, 5);
    expect(r.ok).toBe(true); expect(r.widgets[0]).toMatchObject({ size: 'l', col: 0, row: 0 });
  });
  it('bertabrakan: digeser ke slot bebas terdekat', () => {
    const r = resizeWidget([note('a', 0, 0), W('b', 0, 2)], 'a', 'l', 10, 5);
    expect(r.ok).toBe(true);
    expect(r.widgets[0]).toMatchObject({ size: 'l', col: 2, row: 0 });
  });
  it('tidak ada ruang: ditolak, daftar sama', () => {
    const ws = [note('a', 0, 0), W('b', 0, 2)];
    const r = resizeWidget(ws, 'a', 'l', 4, 4);
    expect(r.ok).toBe(false); expect(r.widgets).toEqual(ws);
  });
  it('ukuran tak diizinkan type ditolak; ukuran sama ok; type clock s->m', () => {
    expect(resizeWidget([W('a', 0, 0)], 'a', 'l', 10, 5).ok).toBe(false);
    expect(resizeWidget([note('a', 0, 0)], 'a', 's', 10, 5).ok).toBe(false);
    expect(resizeWidget([W('a', 0, 0)], 'a', 's', 10, 5).ok).toBe(true);
    expect(resizeWidget([W('a', 0, 0)], 'a', 'm', 10, 5).widgets[0].size).toBe('m');
  });
  it('widget dekat tepi: dijepit ke dalam grid', () => {
    const r = resizeWidget([W('a', 8, 0)], 'a', 'm', 10, 5);
    expect(r.widgets[0]).toMatchObject({ size: 'm', col: 6, row: 0 });
  });
});

describe('addWidget / canAddWidget', () => {
  it('slot bebas pertama, ukuran dan config bawaan type, id unik', () => {
    const a = addWidget([], 'clock', 10, 5, 'id000001');
    expect(a.ok).toBe(true);
    expect(a.widgets[0]).toEqual({ id: 'id000001', type: 'clock', col: 0, row: 0, size: 's', config: {} });
    const b = addWidget(a.widgets, 'note', 10, 5, 'id000002');
    expect(b.widgets[1]).toEqual({ id: 'id000002', type: 'note', col: 2, row: 0, size: 'm', config: { text: '' } });
  });
  it('id bentrok diganti id baru', () => {
    const a = addWidget([W('dup00000', 0, 0)], 'clock', 10, 5, 'dup00000');
    expect(a.id).not.toBe('dup00000');
  });
  it('ditolak: 12 widget, type tak dikenal, tidak ada slot', () => {
    const twelve = Array.from({ length: MAX_WIDGETS }, (_, i) => W(`w${i}`, 0, 0));
    expect(addWidget(twelve, 'clock', 40, 40).ok).toBe(false);
    expect(addWidget([], 'tidak-ada', 10, 5).ok).toBe(false);
    expect(addWidget([W('a', 0, 0, 'm')], 'clock', 4, 2).ok).toBe(false);
    expect(canAddWidget([W('a', 0, 0, 'm')], 'clock', 4, 2)).toBe(false);
    expect(canAddWidget([], 'clock', 4, 2)).toBe(true);
  });
  it('widget tersembunyi (tidak muat) tidak menahan slot', () => {
    const hidden = [W('a', 0, 0, 'l', 'note')];
    expect(addWidget(hidden, 'clock', 3, 3).ok).toBe(true);
  });
});
