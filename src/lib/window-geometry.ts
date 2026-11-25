// Geometri jendela (rect NORMAL, non-maksimal) per tab, disimpan per pengguna dan skin di localStorage. Modul murni: semua akses
// penyimpanan dibungkus try/catch dan data dari penyimpanan tidak dipercaya (divalidasi ketat). Hanya dipakai mode jendela.

export interface GeoRect { x: number; y: number; w: number; h: number }
export type GeometryMap = Record<string, GeoRect>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const GEOMETRY_MAX_ENTRIES = 80;
const MIN_SIDE = 120;      // lebar/tinggi tersimpan terkecil yang masuk akal
const MAX_SIDE = 10000;    // terbesar yang masuk akal (layar 8K pun < ini)
const MAX_COORD = 20000;   // |x|, |y| terbesar yang masuk akal

export const geometryKey = (username: string, skin: string) => `ui-window-geometry:${username}:${skin}`;

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function isValidRect(r: unknown): r is GeoRect {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return isNum(o.x) && isNum(o.y) && isNum(o.w) && isNum(o.h)
    && o.w >= MIN_SIDE && o.w <= MAX_SIDE && o.h >= MIN_SIDE && o.h <= MAX_SIDE
    && Math.abs(o.x) <= MAX_COORD && Math.abs(o.y) <= MAX_COORD;
}

// Saring data mentah: hanya id yang dikenal (bila predikat diberikan) dengan rect valid; dibulatkan; dibatasi jumlahnya (yang terbaru dipertahankan).
export function sanitizeGeometry(raw: unknown, isKnownId?: (id: string) => boolean): GeometryMap {
  const out: GeometryMap = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, r] of Object.entries(raw as Record<string, unknown>)) {
    if (isKnownId && !isKnownId(id)) continue;
    if (!isValidRect(r)) continue;
    out[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  }
  const ids = Object.keys(out);
  if (ids.length > GEOMETRY_MAX_ENTRIES) for (const id of ids.slice(0, ids.length - GEOMETRY_MAX_ENTRIES)) delete out[id];
  return out;
}

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function readGeometry(username: string, skin: string, isKnownId?: (id: string) => boolean, storage: StorageLike | null = defaultStorage()): GeometryMap {
  if (!username) return {};
  try {
    const raw = storage?.getItem(geometryKey(username, skin));
    return raw ? sanitizeGeometry(JSON.parse(raw), isKnownId) : {};
  } catch { return {}; }
}

export function writeGeometry(username: string, skin: string, map: GeometryMap, storage: StorageLike | null = defaultStorage()): void {
  if (!username) return;
  try { storage?.setItem(geometryKey(username, skin), JSON.stringify(sanitizeGeometry(map))); } catch { /* penyimpanan penuh/diblokir: abaikan */ }
}

// Tambah/perbarui satu entri (tab terakhir dipakai ditaruh paling akhir) tanpa mengubah peta asal; rect tidak valid diabaikan.
export function setGeometryEntry(map: GeometryMap, tabId: string, rect: GeoRect): GeometryMap {
  if (!isValidRect(rect)) return map;
  const next: GeometryMap = { ...map };
  delete next[tabId];
  next[tabId] = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
  return sanitizeGeometry(next);
}
