import type { ComponentType } from 'react';
import { Clock as ClockIcon, StickyNote, type LucideIcon } from 'lucide-react';
import { WIDGET_SPECS, type WidgetConfig, type WidgetInstance, type WidgetSize } from '@/lib/widgets';
import type { Action } from '@/types/rbac';
import ClockWidget from './ClockWidget';
import NoteWidget from './NoteWidget';

/*
 * REGISTRY WIDGET (kontrak untuk menambah widget baru; widget berdata W2 memakai ini)
 *
 * Satu tipe widget terdiri dari DUA bagian yang kuncinya harus sama (dijaga tes registry.test.ts):
 *   1. Spec murni di src/lib/widgets.ts (WIDGET_SPECS[type]): defaultSize, allowedSizes, defaultConfig, permission, strictConfig (validasi KETAT untuk
 *      server) dan cleanConfig (pembersih toleran untuk klien). Tidak boleh mengimpor React.
 *   2. Definisi tampilan di bawah (WIDGET_REGISTRY[type]): label, ikon, dan Component.
 *
 * Cara menambah tipe 'sales-today':
 *   - lib/widgets.ts: tambah entri WIDGET_SPECS['sales-today'] (mis. allowedSizes ['s','m'], permission { feature: 'dashboard', action: 'view' },
 *     config {} bila tak ada pengaturan).
 *   - buat SalesTodayWidget.tsx (default export komponen WidgetProps), lalu tambahkan `define('sales-today', { label, icon, Component })` di bawah.
 *   - tidak perlu mengubah WidgetLayer/DesktopShell/API: menu "Tambah widget", ukuran, seret, simpan, dan validasi server mengikuti registry/spec.
 *
 * WidgetProps (yang diterima Component; kartu, header, seret, menu, dan penyimpanan sudah ditangani WidgetCard/WidgetLayer):
 *   id              id instance (unik per pengguna).
 *   size            's' | 'm' | 'l' saat ini; ukuran piksel ditentukan layer, Component mengisi 100% lebar/tinggi isi kartu.
 *   config          config ter-sanitasi (cleanConfig); selalu objek valid.
 *   onConfigChange  simpan config baru (disanitasi lagi, state langsung berubah, penyimpanan server di-debounce ~800 ms).
 *   active          true bila wallpaper terlihat: tab browser terlihat DAN tidak tertutup jendela maksimal (yang tidak dikecilkan). Widget berdata WAJIB
 *                   berhenti polling bila false (pakai useWidgetPolling). Server tidak memeriksa izin per type: widget berdata WAJIB menegakkan izin di endpoint datanya.
 *   creds           header auth ('x-admin-auth') seperti tab lain.
 *   can(feature, action)  cek izin pengguna (super-admin selalu true).
 * Component dirender di dalam kartu yang sudah tahu cara diseret; elemen interaktif (textarea, input, button, a, [data-no-drag]) TIDAK memulai seret.
 * Jangan memakai position:fixed di dalam widget (kartu boleh ber-transform saat diseret).
 */

export interface WidgetProps {
  id: string;
  size: WidgetSize;
  config: WidgetConfig;
  onConfigChange: (next: WidgetConfig) => void;
  active: boolean;
  creds: string;
  can: (feature: string, action: Action) => boolean;
}

export interface WidgetDefinition {
  type: string;
  label: string;
  icon: LucideIcon;
  defaultSize: WidgetSize;
  allowedSizes: readonly WidgetSize[];
  permission?: { feature: string; action: 'view' };
  Component: ComponentType<WidgetProps>;
  /** Pembersih toleran (dari spec): selalu mengembalikan config valid. */
  sanitizeConfig: (raw: unknown) => WidgetConfig;
  defaultConfig: WidgetConfig;
}

/** Yang dibawa AppShell ke DesktopShell: daftar widget pengguna + pengubahnya (hook use-widgets) + konteks izin/auth. */
export interface DesktopWidgetsApi {
  widgets: readonly WidgetInstance[];
  /** Ubah struktur (tambah/pindah/ukuran/hapus). Mutator mengembalikan daftar baru atau null (ditolak). Mengembalikan true bila diterima. */
  apply: (mutator: (cur: WidgetInstance[]) => WidgetInstance[] | null) => boolean;
  /** Ubah config satu widget (penyimpanan di-debounce). */
  setConfig: (id: string, config: WidgetConfig) => void;
  /** Tampilkan pesan galat singkat (toast), mis. "Ruang tidak cukup". */
  notify?: (message: string) => void;
  creds: string;
  can: (feature: string, action: Action) => boolean;
}

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {};

function define(type: string, v: { label: string; icon: LucideIcon; Component: ComponentType<WidgetProps> }) {
  const s = WIDGET_SPECS[type];
  WIDGET_REGISTRY[type] = {
    type, label: v.label, icon: v.icon, Component: v.Component,
    defaultSize: s.defaultSize, allowedSizes: s.allowedSizes, permission: s.permission, defaultConfig: s.defaultConfig, sanitizeConfig: s.cleanConfig,
  };
}

define('clock', { label: 'Jam & tanggal', icon: ClockIcon, Component: ClockWidget });
define('note', { label: 'Catatan tempel', icon: StickyNote, Component: NoteWidget });

export const getWidgetDefinition = (type: string): WidgetDefinition | undefined =>
  Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, type) ? WIDGET_REGISTRY[type] : undefined;
export const listWidgetDefinitions = (): WidgetDefinition[] => Object.values(WIDGET_REGISTRY);

/** Boleh ditampilkan/ditambah oleh pengguna ini (izin 'view' pada fitur yang dibutuhkan, bila ada). */
export const widgetAllowed = (def: WidgetDefinition, can: (feature: string, action: Action) => boolean) =>
  !def.permission || can(def.permission.feature, def.permission.action);
