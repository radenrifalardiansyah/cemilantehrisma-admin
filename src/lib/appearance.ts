// Kontrak pengaturan tampilan (mode Desktop Windows/Mac). Ditulis lebih dulu agar beberapa agent bisa bekerja paralel.
// Pemilik berkas ini: Rheval (boleh melengkapi: parse, cache localStorage, merge). Jangan ubah nama/nilai id tanpa
// menyelaraskan src/lib/wallpapers.ts dan AppearanceDialog.tsx.

export const ACCENTS = ['brand', 'blue', 'teal', 'green', 'graphite', 'purple', 'rose'] as const;
export type AccentId = (typeof ACCENTS)[number];

export const WALLPAPER_IDS = ['gradient', 'waves', 'network', 'geometric', 'nature', 'city', 'architecture', 'office', 'team'] as const;
export type WallpaperId = (typeof WALLPAPER_IDS)[number];

export const DENSITIES = ['compact', 'standard', 'relaxed'] as const;
export type DensityId = (typeof DENSITIES)[number];

export const TEXT_SIZES = ['small', 'standard', 'large'] as const;
export type TextSizeId = (typeof TEXT_SIZES)[number];

export interface Appearance {
  accent: AccentId;
  wallpaper: WallpaperId;
  density: DensityId;
  textSize: TextSizeId;
}

// 'brand' = oranye karamel bawaan aplikasi sekarang; 'gradient' = latar gelap-cokelat bawaan desktop sekarang.
export const DEFAULT_APPEARANCE: Appearance = { accent: 'brand', wallpaper: 'gradient', density: 'standard', textSize: 'standard' };

// Label tampilan (Bahasa Indonesia) dan warna contoh untuk pemilih warna dasar.
// Swatch dipilih agar teks putih di atas aksen/ujung terang gradien tombol dan aksen di atas --accent-bg >= 4.5:1 (ada tesnya).
export const ACCENT_META: Record<AccentId, { label: string; swatch: string }> = {
  brand:    { label: 'Karamel', swatch: '#D4691E' },
  blue:     { label: 'Biru',    swatch: '#2D69A4' },
  teal:     { label: 'Teal',    swatch: '#2B716B' },
  green:    { label: 'Hijau',   swatch: '#357138' },
  graphite: { label: 'Grafit',  swatch: '#4A5568' },
  purple:   { label: 'Ungu',    swatch: '#5B4BA8' },
  rose:     { label: 'Rose',    swatch: '#9B4468' },
};

export const WALLPAPER_LABELS: Record<WallpaperId, string> = {
  gradient: 'Gradasi', waves: 'Gelombang', network: 'Jaringan', geometric: 'Geometri', nature: 'Alam',
  city: 'Kota', architecture: 'Arsitektur', office: 'Kantor', team: 'Tim',
};

export const DENSITY_LABELS: Record<DensityId, string> = { compact: 'Rapat', standard: 'Standar', relaxed: 'Lega' };
export const TEXT_SIZE_LABELS: Record<TextSizeId, string> = { small: 'Kecil', standard: 'Standar', large: 'Besar' };

// ───────────────────────── parse / validasi / cache (dilengkapi Rheval) ─────────────────────────
export const APPEARANCE_KEYS = ['accent', 'wallpaper', 'density', 'textSize'] as const;

const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

// Aman terhadap data rusak: bukan objek -> default; field tak dikenal diabaikan; field tak valid/kurang -> nilai default field itu.
export function parseAppearance(raw: unknown): Appearance {
  let src: unknown = raw;
  if (typeof raw === 'string') { try { src = JSON.parse(raw); } catch { src = null; } }
  const o = (src && typeof src === 'object' && !Array.isArray(src) ? src : {}) as Record<string, unknown>;
  return {
    accent: has(ACCENTS, o.accent) ? o.accent : DEFAULT_APPEARANCE.accent,
    wallpaper: has(WALLPAPER_IDS, o.wallpaper) ? o.wallpaper : DEFAULT_APPEARANCE.wallpaper,
    density: has(DENSITIES, o.density) ? o.density : DEFAULT_APPEARANCE.density,
    textSize: has(TEXT_SIZES, o.textSize) ? o.textSize : DEFAULT_APPEARANCE.textSize,
  };
}

// Validasi KETAT untuk PUT: objek persis dengan empat field valid (tanpa field asing). null bila tidak valid.
export function parseStrictAppearance(raw: unknown): Appearance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== APPEARANCE_KEYS.length || !keys.every(k => (APPEARANCE_KEYS as readonly string[]).includes(k))) return null;
  if (!has(ACCENTS, o.accent) || !has(WALLPAPER_IDS, o.wallpaper) || !has(DENSITIES, o.density) || !has(TEXT_SIZES, o.textSize)) return null;
  return { accent: o.accent, wallpaper: o.wallpaper, density: o.density, textSize: o.textSize };
}

export const sameAppearance = (a: Appearance, b: Appearance) => APPEARANCE_KEYS.every(k => a[k] === b[k]);

// Nilai dari server bila ada (objek), selain itu cache perangkat, terakhir default.
export function resolveAppearance(server: unknown, cached: Appearance | null): Appearance {
  if (server && typeof server === 'object') return parseAppearance(server);
  return cached ?? DEFAULT_APPEARANCE;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = (): StorageLike | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export const appearanceStorageKey = (username: string) => `ui-appearance:${username}`;
export const LAST_APPEARANCE_KEY = 'ui-appearance:last';

function readKey(key: string, storage: StorageLike | null): Appearance | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? parseAppearance(raw) : null;
  } catch { return null; }
}
export const readCachedAppearance = (username: string, storage: StorageLike | null = defaultStorage()) => readKey(appearanceStorageKey(username), storage);
export const readLastAppearance = (storage: StorageLike | null = defaultStorage()) => readKey(LAST_APPEARANCE_KEY, storage);
export function writeLastAppearance(a: Appearance, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(LAST_APPEARANCE_KEY, JSON.stringify(a)); } catch { /* abaikan */ }
}
export function writeCachedAppearance(username: string, a: Appearance, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(appearanceStorageKey(username), JSON.stringify(a)); } catch { /* abaikan */ }
  writeLastAppearance(a, storage);
}
