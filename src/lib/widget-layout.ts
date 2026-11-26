import { MAX_WIDGETS, WIDGET_SPECS, isWidgetType, newWidgetId, normalizeWidgets, type WidgetInstance, type WidgetSize } from '@/lib/widgets';

// Tata letak widget berbasis GRID untuk mode Desktop. Semua fungsi murni (tanpa DOM) dan diuji terpisah.
//
// KEPUTUSAN GRID
// - Sel 112px, celah 12px (pitch 124px), margin area 12px. Konstanta dicatat di sini dan dipakai komponen; tidak ada duplikat di CSS.
// - Kolom dihitung dari tepi KANAN (col 0 = kolom paling kanan), baris dari atas. Alasannya: ikon meja (Windows) mengalir dari kiri, jadi widget tidak
//   menabrak ikon pertama; dan posisi tersimpan stabil saat lebar layar berubah (widget "menempel" ke kanan seperti widget macOS/Windows).
// - Ukuran: s = 2x2 sel, m = 4x2, l = 4x3.
// - Area grid = area kerja desktop (WinArea): di bawah menu bar Mac (top) dan di atas taskbar/dock (bottom), inset sama dengan AREA_INSETS window manager.
// - Posisi tersimpan (col,row) adalah posisi DIINGINKAN. Layar kecil hanya mengubah TAMPILAN lewat fitToGrid (jepit/geser ke slot bebas terdekat/
//   sembunyi bila tidak muat); data tersimpan tidak diubah, jadi widget kembali ke tempatnya di layar besar (pelajaran window-reducer).

export const CELL = 112;
export const GAP = 12;
export const PAD = 12;
export const PITCH = CELL + GAP;

export interface Cells { w: number; h: number }
export interface Rect { col: number; row: number; w: number; h: number }
export interface GridArea { w: number; h: number; top: number; bottom: number }
export interface GridDims { cols: number; rows: number }

const SIZE_CELLS: Record<WidgetSize, Cells> = { s: { w: 2, h: 2 }, m: { w: 4, h: 2 }, l: { w: 4, h: 3 } };
export const sizeCells = (size: WidgetSize): Cells => SIZE_CELLS[size];

/** Jumlah kolom/baris yang muat di area kerja (>= 0). */
export function gridDims(area: GridArea): GridDims {
  const cols = Math.floor((area.w - 2 * PAD + GAP) / PITCH);
  const rows = Math.floor((area.h - area.top - area.bottom - 2 * PAD + GAP) / PITCH);
  return { cols: Math.max(0, cols), rows: Math.max(0, rows) };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

/** Jepit rect ke dalam grid (ukuran tetap). Bila grid lebih kecil dari rect, posisi 0. */
export function clampToGrid(rect: Rect, cols: number, rows: number): Rect {
  return {
    ...rect,
    col: Math.max(0, Math.min(rect.col, cols - rect.w)),
    row: Math.max(0, Math.min(rect.row, rows - rect.h)),
  };
}

export const inGrid = (r: Rect, cols: number, rows: number) => r.col >= 0 && r.row >= 0 && r.col + r.w <= cols && r.row + r.h <= rows;

/** Rect boleh ditaruh: seluruhnya di dalam grid dan tidak menimpa rect lain. */
export function canPlace(rect: Rect, others: readonly Rect[], cols: number, rows: number): boolean {
  return inGrid(rect, cols, rows) && !others.some(o => rectsOverlap(rect, o));
}

/**
 * Slot kosong untuk widget berukuran `cells`. Tanpa `near`: urutan baris lalu kolom (baris 0 dari kolom paling kanan). Dengan `near`: slot dengan jarak
 * Manhattan terkecil ke titik itu (seri: baris lalu kolom). null bila tidak ada.
 */
export function findFreeSlot(cells: Cells, others: readonly Rect[], cols: number, rows: number, near?: { col: number; row: number }): { col: number; row: number } | null {
  let best: { col: number; row: number } | null = null;
  let bestD = Infinity;
  for (let row = 0; row + cells.h <= rows; row++) {
    for (let col = 0; col + cells.w <= cols; col++) {
      if (!canPlace({ col, row, ...cells }, others, cols, rows)) continue;
      if (!near) return { col, row };
      const d = Math.abs(col - near.col) + Math.abs(row - near.row);
      if (d < bestD) { bestD = d; best = { col, row }; }
    }
  }
  return best;
}

const rectOf = (w: WidgetInstance): Rect => ({ col: w.col, row: w.row, ...sizeCells(w.size) });

/**
 * Posisi TAMPILAN tiap widget di grid cols x rows: berurutan sesuai array; yang dijepit ke grid; bila bertabrakan dengan yang sudah ditempatkan,
 * pindah ke slot bebas terdekat; null bila tidak muat sama sekali (disembunyikan, data tetap). Tidak mengubah widget tersimpan.
 */
export function fitToGrid(widgets: readonly WidgetInstance[], cols: number, rows: number): Map<string, Rect | null> {
  const out = new Map<string, Rect | null>();
  const placed: Rect[] = [];
  for (const w of widgets) {
    const cells = sizeCells(w.size);
    if (cells.w > cols || cells.h > rows) { out.set(w.id, null); continue; }
    const want = clampToGrid(rectOf(w), cols, rows);
    let spot: Rect | null = canPlace(want, placed, cols, rows) ? want : null;
    if (!spot) {
      const s = findFreeSlot(cells, placed, cols, rows, { col: want.col, row: want.row });
      spot = s ? { ...s, ...cells } : null;
    }
    if (spot) placed.push(spot);
    out.set(w.id, spot);
  }
  return out;
}

export interface LayoutResult { widgets: WidgetInstance[]; ok: boolean }

const othersOf = (layout: Map<string, Rect | null>, id: string): Rect[] =>
  [...layout.entries()].filter(([k, r]) => k !== id && r).map(([, r]) => r as Rect);

/**
 * Pindahkan widget ke (col,row) (snap grid, dijepit ke grid). Bila tujuan menimpa widget lain: ditolak (ok=false, daftar sama persis).
 * Yang disimpan adalah posisi baru (posisi diinginkan).
 */
export function moveWidget(widgets: readonly WidgetInstance[], id: string, col: number, row: number, cols: number, rows: number): LayoutResult {
  const w = widgets.find(x => x.id === id);
  if (!w) return { widgets: [...widgets], ok: false };
  const cells = sizeCells(w.size);
  if (cells.w > cols || cells.h > rows) return { widgets: [...widgets], ok: false };
  const target = clampToGrid({ col: Math.round(col), row: Math.round(row), ...cells }, cols, rows);
  const layout = fitToGrid(widgets, cols, rows);
  if (!canPlace(target, othersOf(layout, id), cols, rows)) return { widgets: [...widgets], ok: false };
  if (target.col === w.col && target.row === w.row) return { widgets: [...widgets], ok: true };
  return { widgets: widgets.map(x => (x.id === id ? { ...x, col: target.col, row: target.row } : x)), ok: true };
}

/** Geser satu langkah (dCol/dRow sel) dari posisi TAMPILAN saat ini. Ditolak bila menabrak atau keluar grid. */
export function nudgeWidget(widgets: readonly WidgetInstance[], id: string, dCol: number, dRow: number, cols: number, rows: number): LayoutResult {
  const w = widgets.find(x => x.id === id);
  const cur = w ? fitToGrid(widgets, cols, rows).get(id) : null;
  if (!w || !cur) return { widgets: [...widgets], ok: false };
  const nc = cur.col + dCol; const nr = cur.row + dRow;
  if (nc < 0 || nr < 0 || nc + cur.w > cols || nr + cur.h > rows) return { widgets: [...widgets], ok: false };
  return moveWidget(widgets, id, nc, nr, cols, rows);
}

/**
 * Ubah ukuran. Mulai dari posisi tampilan saat ini; bila ukuran baru bertabrakan/keluar grid, coba slot bebas terdekat; bila tidak ada: ditolak
 * (ok=false, daftar sama persis; pemanggil menampilkan "Ruang tidak cukup"). Ukuran yang tidak diizinkan type-nya juga ditolak.
 */
export function resizeWidget(widgets: readonly WidgetInstance[], id: string, size: WidgetSize, cols: number, rows: number): LayoutResult {
  const w = widgets.find(x => x.id === id);
  if (!w || !isWidgetType(w.type) || !WIDGET_SPECS[w.type].allowedSizes.includes(size)) return { widgets: [...widgets], ok: false };
  if (size === w.size) return { widgets: [...widgets], ok: true };
  const layout = fitToGrid(widgets, cols, rows);
  const from = layout.get(id) ?? { col: w.col, row: w.row };
  const cells = sizeCells(size);
  if (cells.w > cols || cells.h > rows) return { widgets: [...widgets], ok: false };
  const others = othersOf(layout, id);
  const want = clampToGrid({ col: from.col, row: from.row, ...cells }, cols, rows);
  let spot: { col: number; row: number } | null = canPlace(want, others, cols, rows) ? { col: want.col, row: want.row } : null;
  if (!spot) spot = findFreeSlot(cells, others, cols, rows, { col: want.col, row: want.row });
  if (!spot) return { widgets: [...widgets], ok: false };
  return { widgets: widgets.map(x => (x.id === id ? { ...x, size, col: spot.col, row: spot.row } : x)), ok: true };
}

export interface AddResult extends LayoutResult { id?: string }

/** Tambah widget baru berukuran bawaan type-nya di slot bebas pertama (baris lalu kolom). Ditolak bila sudah MAX_WIDGETS, type tak dikenal, atau tidak ada slot. */
export function addWidget(widgets: readonly WidgetInstance[], type: string, cols: number, rows: number, id: string = newWidgetId()): AddResult {
  const same = { widgets: [...widgets], ok: false };
  if (!isWidgetType(type) || widgets.length >= MAX_WIDGETS) return same;
  const spec = WIDGET_SPECS[type];
  const layout = fitToGrid(widgets, cols, rows);
  const slot = findFreeSlot(sizeCells(spec.defaultSize), othersOf(layout, ''), cols, rows);
  if (!slot) return same;
  const used = new Set(widgets.map(w => w.id));
  let nid = id;
  while (used.has(nid)) nid = newWidgetId();
  const item: WidgetInstance = { id: nid, type, col: slot.col, row: slot.row, size: spec.defaultSize, config: { ...spec.defaultConfig } };
  return { widgets: [...widgets, item], ok: true, id: nid };
}

/** Apakah masih ada slot untuk widget baru bertipe ini (untuk menonaktifkan item menu). */
export function canAddWidget(widgets: readonly WidgetInstance[], type: string, cols: number, rows: number): boolean {
  return addWidget(widgets, type, cols, rows, '________').ok;
}

export { normalizeWidgets };

// ── Geometri piksel (relatif terhadap lapisan widget; kolom dari kanan) ──

export interface WidgetBox { right: number; top: number; width: number; height: number }
export const spanPx = (n: number) => n * CELL + (n - 1) * GAP;

export function widgetBox(r: Rect): WidgetBox {
  return { right: PAD + r.col * PITCH, top: PAD + r.row * PITCH, width: spanPx(r.w), height: spanPx(r.h) };
}

/**
 * Sel tujuan dari posisi piksel sisi kiri-atas kartu (relatif lapisan) saat diseret: dibulatkan ke sel terdekat. layerW = lebar lapisan.
 * Hasil belum dijepit (dipakai moveWidget/clampToGrid).
 */
export function snapToCell(leftPx: number, topPx: number, cells: Cells, layerW: number): { col: number; row: number } {
  const rightEdge = leftPx + spanPx(cells.w);
  return { col: Math.round((layerW - PAD - rightEdge) / PITCH), row: Math.round((topPx - PAD) / PITCH) };
}
