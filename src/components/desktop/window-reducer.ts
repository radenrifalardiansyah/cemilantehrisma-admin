// Logika murni window manager mode Desktop (tanpa React/DOM supaya mudah diuji).
// Aturan: SATU jendela per tab (singleton) — membuka tab yang sudah ada memulihkan + memfokus jendelanya.
// Jendela yang "fokus" = jendela tidak diminimalkan dengan z tertinggi (tidak ada field fokus terpisah).

export type DesktopSkin = 'windows' | 'mac';

export interface WinArea {
  w: number;       // lebar kanvas (viewport)
  h: number;       // tinggi kanvas (viewport)
  top: number;     // inset atas yang tidak boleh ditutup jendela (menu bar Mac = 28)
  bottom: number;  // inset bawah (taskbar Windows = 48, dock Mac = 92)
}

export interface WinState {
  tabId: string;
  x: number; y: number; w: number; h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
}

export interface WmState {
  windows: WinState[];   // urutan = urutan dibuka (dipakai taskbar)
  area: WinArea;
  zTop: number;
}

export type WmAction =
  | { type: 'open'; tabId: string; size?: { w: number; h: number } }
  | { type: 'focus'; tabId: string }
  | { type: 'minimize'; tabId: string }
  | { type: 'maximize'; tabId: string }   // toggle maksimalkan/pulihkan
  | { type: 'close'; tabId: string }
  | { type: 'move'; tabId: string; x: number; y: number }
  | { type: 'resize'; tabId: string; x: number; y: number; w: number; h: number }
  | { type: 'arrange' }
  | { type: 'closeAll' }
  | { type: 'setArea'; area: WinArea };

export const AREA_INSETS: Record<DesktopSkin, { top: number; bottom: number }> = {
  windows: { top: 0, bottom: 48 },
  mac: { top: 28, bottom: 92 },
};

export const MIN_W = 320;
export const MIN_H = 200;
const TITLEBAR_H = 38;
const KEEP_VISIBLE_X = 80;   // minimal sebagian judul tetap terlihat saat digeser keluar layar

export const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  dashboard: { w: 920, h: 600 },
  orders: { w: 900, h: 580 },
  products: { w: 880, h: 560 },
  wallets: { w: 760, h: 520 },
  income: { w: 820, h: 540 },
  expenses: { w: 820, h: 540 },
  pos: { w: 1080, h: 640 },
};
// Ukuran minimum per tab. Kasir memakai breakpoint viewport (grid katalog + panel 400px), jadi jendela yang terlalu
// sempit membuat katalog hilang.
export const MIN_SIZES: Record<string, { w: number; h: number }> = { pos: { w: 820, h: 480 } };
export const minSizeFor = (tabId: string) => MIN_SIZES[tabId] ?? { w: MIN_W, h: MIN_H };
const FALLBACK_SIZE = { w: 860, h: 540 };

export function makeArea(w: number, h: number, skin: DesktopSkin): WinArea {
  return { w, h, ...AREA_INSETS[skin] };
}

export function initialWmState(area: WinArea = makeArea(1280, 720, 'windows')): WmState {
  return { windows: [], area, zTop: 0 };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

function usableHeight(a: WinArea) { return Math.max(0, a.h - a.top - a.bottom); }

// Ukuran dibatasi ke area; x/y dijaga supaya judul tetap bisa diraih.
export function clampRect(r: { x: number; y: number; w: number; h: number }, a: WinArea, min: { w: number; h: number } = { w: MIN_W, h: MIN_H }) {
  const w = clamp(Math.round(r.w), Math.min(min.w, a.w), a.w);
  const h = clamp(Math.round(r.h), Math.min(min.h, usableHeight(a)), usableHeight(a));
  const x = clamp(Math.round(r.x), -(w - KEEP_VISIBLE_X), a.w - KEEP_VISIBLE_X);
  const y = clamp(Math.round(r.y), a.top, a.h - a.bottom - TITLEBAR_H);
  return { x, y, w, h };
}

// Dipakai saat area berubah (resize layar / ganti skin): selain dijepit, jendela ditarik masuk supaya
// seluruhnya terlihat bila muat (berbeda dari drag yang boleh menjulur keluar sebagian).
export function fitRect(r: { x: number; y: number; w: number; h: number }, a: WinArea, min?: { w: number; h: number }) {
  const c = clampRect(r, a, min);
  return {
    ...c,
    x: clamp(c.x, 0, a.w - c.w),
    y: clamp(c.y, a.top, a.h - a.bottom - c.h),
  };
}

// Posisi awal berjenjang (cascade) supaya jendela baru tidak menumpuk persis.
export function cascadeRect(tabId: string, index: number, a: WinArea, size?: { w: number; h: number }) {
  const base = size ?? DEFAULT_SIZES[tabId] ?? FALLBACK_SIZE;
  const w = Math.min(base.w, a.w - 80);
  const h = Math.min(base.h, usableHeight(a) - 24);
  const step = index % 6;
  return fitRect({ x: 96 + step * 34, y: a.top + 16 + step * 30, w, h }, a, minSizeFor(tabId));
}

const byTab = (s: WmState, tabId: string) => s.windows.find(w => w.tabId === tabId);
const update = (s: WmState, tabId: string, patch: Partial<WinState>): WmState => ({
  ...s, windows: s.windows.map(w => (w.tabId === tabId ? { ...w, ...patch } : w)),
});

export function focusedTabId(s: WmState): string | null {
  let best: WinState | null = null;
  for (const w of s.windows) if (!w.minimized && (!best || w.z > best.z)) best = w;
  return best?.tabId ?? null;
}

// Jendela tidak-minimal teratas selain `except` (dipakai memilih fokus berikutnya).
export function topTabId(s: WmState, except?: string): string | null {
  return focusedTabId({ ...s, windows: s.windows.filter(w => w.tabId !== except) });
}

export function wmReducer(s: WmState, a: WmAction): WmState {
  switch (a.type) {
    case 'open': {
      const existing = byTab(s, a.tabId);
      const z = s.zTop + 1;
      if (existing) return { ...update(s, a.tabId, { minimized: false, z }), zTop: z };
      const r = cascadeRect(a.tabId, s.windows.length, s.area, a.size);
      const win: WinState = { tabId: a.tabId, ...r, z, minimized: false, maximized: false };
      return { ...s, windows: [...s.windows, win], zTop: z };
    }
    case 'focus': {
      const w = byTab(s, a.tabId);
      if (!w) return s;
      if (!w.minimized && focusedTabId(s) === a.tabId) return s;
      const z = s.zTop + 1;
      return { ...update(s, a.tabId, { minimized: false, z }), zTop: z };
    }
    case 'minimize': {
      const w = byTab(s, a.tabId);
      if (!w || w.minimized) return s;
      return update(s, a.tabId, { minimized: true });
    }
    case 'maximize': {
      const w = byTab(s, a.tabId);
      if (!w) return s;
      const z = s.zTop + 1;
      return { ...update(s, a.tabId, { maximized: !w.maximized, minimized: false, z }), zTop: z };
    }
    case 'close': {
      if (!byTab(s, a.tabId)) return s;
      return { ...s, windows: s.windows.filter(w => w.tabId !== a.tabId) };
    }
    case 'move': {
      const w = byTab(s, a.tabId);
      if (!w || w.maximized) return s;
      const r = clampRect({ x: a.x, y: a.y, w: w.w, h: w.h }, s.area, minSizeFor(a.tabId));
      if (r.x === w.x && r.y === w.y) return s;
      return update(s, a.tabId, { x: r.x, y: r.y });
    }
    case 'resize': {
      const w = byTab(s, a.tabId);
      if (!w || w.maximized) return s;
      const r = clampRect({ x: a.x, y: a.y, w: a.w, h: a.h }, s.area, minSizeFor(a.tabId));
      // Tepi bawah tidak boleh masuk ke bawah taskbar/dock (pegangan jadi tak terjangkau).
      return update(s, a.tabId, { ...r, h: Math.max(Math.min(minSizeFor(a.tabId).h, usableHeight(s.area)), Math.min(r.h, s.area.h - s.area.bottom - r.y)) });
    }
    case 'arrange': {
      // Susun ulang semua jendela berjenjang sesuai urutan buka; z mengikuti urutan itu, yang terakhir di atas.
      let z = s.zTop;
      const windows = s.windows.map((w, i) => {
        z += 1;
        return { ...w, ...cascadeRect(w.tabId, i, s.area), maximized: false, z };
      });
      return { ...s, windows, zTop: z };
    }
    case 'closeAll':
      return s.windows.length ? { ...s, windows: [] } : s;
    case 'setArea': {
      const n = a.area;
      if (n.w === s.area.w && n.h === s.area.h && n.top === s.area.top && n.bottom === s.area.bottom) return s;
      return {
        ...s, area: n,
        windows: s.windows.map(w => ({ ...w, ...fitRect(w, n, minSizeFor(w.tabId)) })),
      };
    }
  }
}

// Rect yang dirender: jendela maksimal memenuhi area kanvas (di antara menu bar dan taskbar/dock).
export function renderRect(w: WinState, a: WinArea) {
  return w.maximized
    ? { x: 0, y: a.top, w: a.w, h: usableHeight(a) }
    : { x: w.x, y: w.y, w: w.w, h: w.h };
}
