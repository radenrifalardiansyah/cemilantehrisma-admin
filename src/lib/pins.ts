import { DESKTOP_SHORTCUT_TABS, isWindowTab } from '@/lib/ui-layout';

// Menu yang disematkan (pin) ke tampilan depan Desktop: ikon meja (Windows) dan dock (Mac). Urutan = urutan disematkan.
// null (belum pernah memilih) = DEFAULT_PINS, jadi tampilan sama persis dengan sebelum fitur ini ada.
export const MAX_PINS = 40;
export const DEFAULT_PINS: readonly string[] = DESKTOP_SHORTCUT_TABS;

// Hanya menu berjendela yang bisa disematkan (ikonnya membuka jendela).
export const isPinnable = (tab: string) => isWindowTab(tab);

function strictList(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PINS) return null;
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string' || !isPinnable(v) || seen.has(v)) return null;
    seen.add(v);
  }
  return [...raw] as string[];
}

// Validasi KETAT untuk PUT: array string unik, semuanya menu berjendela yang dikenal, maksimum MAX_PINS. null bila tidak valid.
export const parseStrictPins = strictList;

// Pembacaan toleran (server/cache): nilai rusak -> null (= default); string JSON (mentah/terenkode ganda) diurai hingga dua lapis;
// id yang tak dikenal (menu dihapus/diganti) dibuang, bukan membatalkan seluruh daftar.
export function parsePins(raw: unknown): string[] | null {
  let v: unknown = raw;
  for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v as string); } catch { return null; } }
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) if (typeof x === 'string' && isPinnable(x) && !seen.has(x)) { seen.add(x); out.push(x); }
  return out.slice(0, MAX_PINS);
}

export const effectivePins = (pins: readonly string[] | null): readonly string[] => pins ?? DEFAULT_PINS;

export function togglePin(current: readonly string[] | null, tab: string): string[] {
  const base = [...effectivePins(current)];
  return base.includes(tab) ? base.filter(t => t !== tab) : [...base, tab];
}

export const samePins = (a: readonly string[] | null, b: readonly string[] | null) =>
  a === b || (a !== null && b !== null && a.length === b.length && a.every((t, i) => t === b[i]));

// Server (nilai valid termasuk array kosong) menang; selain itu cache perangkat; selain itu null (default).
export function resolvePins(server: unknown, cached: string[] | null): string[] | null {
  const s = parsePins(server);
  return s ?? cached;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = (): StorageLike | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
export const pinsStorageKey = (username: string) => `ui-pins:${username}`;
export const LAST_PINS_KEY = 'ui-pins:last';

const read = (key: string, storage: StorageLike | null): string[] | null => { try { const r = storage?.getItem(key); return r ? parsePins(r) : null; } catch { return null; } };
export const readCachedPins = (username: string, storage: StorageLike | null = defaultStorage()) => read(pinsStorageKey(username), storage);
export const readLastPins = (storage: StorageLike | null = defaultStorage()) => read(LAST_PINS_KEY, storage);
export function writeCachedPins(username: string, pins: string[] | null, storage: StorageLike | null = defaultStorage()): void {
  const v = pins === null ? '' : JSON.stringify(pins);
  try { storage?.setItem(pinsStorageKey(username), v); } catch { /* abaikan */ }
  try { storage?.setItem(LAST_PINS_KEY, v); } catch { /* abaikan */ }
}
