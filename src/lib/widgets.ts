// Widget di tampilan depan (wallpaper) mode Desktop: model data, validasi, dan cache perangkat. Murni (tanpa React/DOM) supaya dipakai
// bersama oleh server (PUT /api/me/widgets, GET /api/me) dan klien (hook use-widgets, registry).
//
// MENAMBAH TIPE WIDGET BARU (kontrak untuk agent lain):
//   1. Tambahkan satu entri ke WIDGET_SPECS di bawah (ukuran yang diizinkan, config bawaan, validasi KETAT untuk server, pembersih toleran untuk
//      klien, izin yang dibutuhkan). Berkas ini TIDAK boleh mengimpor React/lucide.
//   2. Daftarkan komponennya di src/components/desktop/widgets/registry.ts (label, ikon, Component). Tes registry memastikan kunci registry == WIDGET_SPECS.
// Penyimpanan: kolom profiles.ui_widgets (jsonb nullable). null = belum memilih = tanpa widget.

export type WidgetSize = 's' | 'm' | 'l';
export const WIDGET_SIZES: readonly WidgetSize[] = ['s', 'm', 'l'];
export type WidgetConfig = Record<string, unknown>;

export interface WidgetInstance {
  /** Id unik per pengguna (8 karakter acak), kunci React dan target PUT. */
  id: string;
  /** Kunci di WIDGET_SPECS. */
  type: string;
  /** Posisi sel grid: kolom dihitung dari tepi KANAN (0 = kolom paling kanan), baris dari atas. Itulah posisi "diinginkan"; tampilan boleh digeser (lihat widget-layout). */
  col: number;
  row: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

export const MAX_WIDGETS = 12;
/** Batas koordinat tersimpan (col/row harus < nilai ini): jauh di atas grid layar sungguhan, hanya menolak sampah. */
export const MAX_COORD = 40;
export const MAX_NOTE_CHARS = 500;
/** Batas panjang JSON config per widget (karakter). Catatan 500 karakter dengan escape terburuk (tanda kutip/baris baru) ~1010. */
export const MAX_CONFIG_JSON = 1100;

export interface WidgetSpec {
  defaultSize: WidgetSize;
  allowedSizes: readonly WidgetSize[];
  defaultConfig: WidgetConfig;
  /** Izin pengguna yang dibutuhkan untuk MENAMPILKAN widget (kosong = semua pengguna). Hanya untuk UI; data widget tetap dijaga API-nya sendiri. */
  permission?: { feature: string; action: 'view' };
  /** Validasi KETAT (PUT): config yang valid (sudah bersih) atau null bila ada kunci asing/tipe salah/terlalu besar. undefined = tanpa config. */
  strictConfig: (raw: unknown) => WidgetConfig | null;
  /** Pembacaan TOLERAN (server/cache/penyimpan klien): selalu mengembalikan config valid; kunci asing dibuang, nilai buruk -> bawaan. */
  cleanConfig: (raw: unknown) => WidgetConfig;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

// Teks catatan: tanpa karakter kontrol selain baris baru dan tab.
const BAD_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BAD_CTRL_G = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const CLOCK_FORMATS = ['hm', 'hms'] as const;

export const WIDGET_SPECS: Record<string, WidgetSpec> = {
  clock: {
    defaultSize: 's',
    allowedSizes: ['s', 'm'],
    defaultConfig: {},
    strictConfig(raw) {
      if (raw === undefined) return {};
      if (!isPlainObject(raw)) return null;
      const keys = Object.keys(raw);
      if (keys.some(k => k !== 'format')) return null;
      if ('format' in raw) {
        if (typeof raw.format !== 'string' || !(CLOCK_FORMATS as readonly string[]).includes(raw.format)) return null;
        return { format: raw.format };
      }
      return {};
    },
    cleanConfig(raw) {
      if (isPlainObject(raw) && typeof raw.format === 'string' && (CLOCK_FORMATS as readonly string[]).includes(raw.format)) return { format: raw.format };
      return {};
    },
  },
  note: {
    defaultSize: 'm',
    allowedSizes: ['m', 'l'],
    defaultConfig: { text: '' },
    strictConfig(raw) {
      if (raw === undefined) return { text: '' };
      if (!isPlainObject(raw)) return null;
      if (Object.keys(raw).some(k => k !== 'text')) return null;
      if (!('text' in raw)) return { text: '' };
      if (typeof raw.text !== 'string' || raw.text.length > MAX_NOTE_CHARS || BAD_CTRL.test(raw.text)) return null;
      return { text: raw.text };
    },
    cleanConfig(raw) {
      const t = isPlainObject(raw) && typeof raw.text === 'string' ? raw.text.replace(BAD_CTRL_G, '').slice(0, MAX_NOTE_CHARS) : '';
      return { text: t };
    },
  },
};

export const isWidgetType = (t: unknown): t is string => typeof t === 'string' && Object.prototype.hasOwnProperty.call(WIDGET_SPECS, t);
export const isWidgetSize = (s: unknown): s is WidgetSize => s === 's' || s === 'm' || s === 'l';
const ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

/** Id acak 8 karakter (huruf kecil+angka). */
export function newWidgetId(rand: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

const isCoord = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < MAX_COORD;

// Validasi KETAT untuk PUT: array maks MAX_WIDGETS berisi objek {id, type, col, row, size, config?} tanpa kunci asing; id unik; type dikenal;
// size diizinkan untuk type itu; col/row bilangan bulat 0..MAX_COORD-1; config lolos strictConfig type-nya dan JSON-nya <= MAX_CONFIG_JSON.
// Mengembalikan salinan bersih, atau null bila ada satu saja yang tidak valid.
export function parseStrictWidgets(raw: unknown): WidgetInstance[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_WIDGETS) return null;
  const seen = new Set<string>();
  const out: WidgetInstance[] = [];
  for (const w of raw) {
    if (!isPlainObject(w)) return null;
    if (Object.keys(w).some(k => k !== 'id' && k !== 'type' && k !== 'col' && k !== 'row' && k !== 'size' && k !== 'config')) return null;
    const { id, type, col, row, size, config } = w;
    if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) return null;
    if (!isWidgetType(type)) return null;
    const spec = WIDGET_SPECS[type];
    if (!isWidgetSize(size) || !spec.allowedSizes.includes(size)) return null;
    if (!isCoord(col) || !isCoord(row)) return null;
    seen.add(id);
    const item: WidgetInstance = { id, type, col, row, size };
    if (config !== undefined) {
      const c = spec.strictConfig(config);
      if (c === null || JSON.stringify(c).length > MAX_CONFIG_JSON) return null;
      item.config = c;
    }
    out.push(item);
  }
  return out;
}

// Hapus duplikat id, tipe tak dikenal, dan batasi MAX_WIDGETS. Item yang tidak berbentuk widget dibuang (bukan membatalkan semuanya).
export function normalizeWidgets(list: readonly WidgetInstance[]): WidgetInstance[] {
  const seen = new Set<string>();
  const out: WidgetInstance[] = [];
  for (const w of list) {
    if (!w || typeof w.id !== 'string' || seen.has(w.id) || !isWidgetType(w.type)) continue;
    seen.add(w.id);
    out.push(w);
    if (out.length >= MAX_WIDGETS) break;
  }
  return out;
}

// Pembacaan toleran (server/cache): nilai rusak/bukan array -> null (= belum memilih); [] tetap [] (pengguna menghapus semua). String JSON (mentah /
// terenkode ganda lewat pooler) diurai hingga dua lapis. Item yang rusak dibuang; ukuran/koordinat/config buruk diperbaiki ke nilai aman.
export function parseWidgets(raw: unknown): WidgetInstance[] | null {
  let v: unknown = raw;
  for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v as string); } catch { return null; } }
  if (!Array.isArray(v)) return null;
  const out: WidgetInstance[] = [];
  const seen = new Set<string>();
  for (const w of v) {
    if (!isPlainObject(w) || typeof w.id !== 'string' || !ID_RE.test(w.id) || seen.has(w.id) || !isWidgetType(w.type)) continue;
    const spec = WIDGET_SPECS[w.type];
    const size = isWidgetSize(w.size) && spec.allowedSizes.includes(w.size) ? w.size : spec.defaultSize;
    const col = isCoord(w.col) ? w.col : 0;
    const row = isCoord(w.row) ? w.row : 0;
    seen.add(w.id);
    out.push({ id: w.id, type: w.type, col, row, size, config: spec.cleanConfig(w.config) });
    if (out.length >= MAX_WIDGETS) break;
  }
  return out;
}

export const sameWidgets = (a: readonly WidgetInstance[] | null, b: readonly WidgetInstance[] | null) =>
  a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

// Server (nilai valid termasuk array kosong) menang; selain itu cache perangkat; selain itu null.
export function resolveWidgets(server: unknown, cached: WidgetInstance[] | null): WidgetInstance[] | null {
  return parseWidgets(server) ?? cached;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = (): StorageLike | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
export const widgetsStorageKey = (username: string) => `ui-widgets:${username}`;

const read = (key: string, storage: StorageLike | null): WidgetInstance[] | null => { try { const r = storage?.getItem(key); return r ? parseWidgets(r) : null; } catch { return null; } };
export const readCachedWidgets = (username: string, storage: StorageLike | null = defaultStorage()) => read(widgetsStorageKey(username), storage);
export function writeCachedWidgets(username: string, widgets: WidgetInstance[] | null, storage: StorageLike | null = defaultStorage()): void {
  const v = widgets === null ? '' : JSON.stringify(widgets);
  try { storage?.setItem(widgetsStorageKey(username), v); } catch { /* abaikan */ }
}
