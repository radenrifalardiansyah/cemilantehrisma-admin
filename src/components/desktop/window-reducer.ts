// Logika murni window manager mode Desktop (tanpa React/DOM supaya mudah diuji).
// Aturan: SATU jendela per tab (singleton) — membuka tab yang sudah ada memulihkan + memfokus jendelanya.
// Jendela yang "fokus" = jendela tidak diminimalkan dengan z tertinggi (tidak ada field fokus terpisah).

export type DesktopSkin = 'windows' | 'mac';

export interface WinArea {
  w: number;       // lebar kanvas (viewport)
  h: number;       // tinggi kanvas (viewport)
  top: number;     // inset atas yang tidak boleh ditutup jendela (menu bar Mac = 28)
  bottom: number;  // inset bawah (taskbar Windows = 48, dock Mac = 66)
}

export interface WinState {
  tabId: string;
  x: number; y: number; w: number; h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Tempel ke tepi (setengah layar): sisi yang ditempel; `restore` = rect sebelum ditempel (untuk dipulihkan saat ditarik). */
  snapped?: SnapSide;
  restore?: { x: number; y: number; w: number; h: number };
  /** Rect "diinginkan" (sebelum dijepit area): hanya berubah oleh aksi pengguna, bukan oleh setArea, sehingga jendela yang disusutkan layar kecil tumbuh kembali di layar besar. */
  desired?: { x: number; y: number; w: number; h: number };
}

export type SnapSide = 'left' | 'right' | 'top';
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface WmState {
  windows: WinState[];   // urutan = urutan dibuka (dipakai taskbar)
  area: WinArea;
  zTop: number;
}

export type WmAction =
  | { type: 'open'; tabId: string; size?: { w: number; h: number }; rect?: { x: number; y: number; w: number; h: number } }
  | { type: 'focus'; tabId: string }
  | { type: 'minimize'; tabId: string }
  | { type: 'maximize'; tabId: string }   // toggle maksimalkan/pulihkan
  | { type: 'close'; tabId: string }
  | { type: 'move'; tabId: string; x: number; y: number }
  | { type: 'resize'; tabId: string; x: number; y: number; w: number; h: number }
  | { type: 'snap'; tabId: string; side: SnapSide; from?: { x: number; y: number; w: number; h: number } }   // left/right = setengah area kerja; top = maksimal; from = rect SEBELUM digeser (bahan pemulihan)
  | { type: 'restoreAt'; tabId: string; x: number; y: number }       // lepas dari maksimal/tempel ke ukuran semula, titlebar di (x, y)
  | { type: 'settle'; tabId: string }                                // geser/ubah ukuran selesai (tanda untuk penyimpan geometri; state tidak berubah isinya)
  | { type: 'arrange' }
  | { type: 'closeAll' }
  | { type: 'setArea'; area: WinArea };

export const AREA_INSETS: Record<DesktopSkin, { top: number; bottom: number }> = {
  windows: { top: 0, bottom: 48 },
  mac: { top: 28, bottom: 66 },
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
  consignment: { w: 1000, h: 620 },
  'wa-forward': { w: 760, h: 520 },
  'mitra-report': { w: 900, h: 580 },
  'finance-report': { w: 980, h: 620 },
  suppliers: { w: 860, h: 560 },
  materials: { w: 980, h: 620 },
  'purchase-orders': { w: 980, h: 620 },
  'goods-receipts': { w: 980, h: 620 },
  stock: { w: 980, h: 620 },
  production: { w: 980, h: 620 },
  'product-report': { w: 980, h: 620 },
  capital: { w: 900, h: 580 },
  'po-report': { w: 980, h: 620 },
  'gr-report': { w: 980, h: 620 },
  'opname-report': { w: 980, h: 620 },
  'stock-report': { w: 980, h: 620 },
  'stall-report': { w: 980, h: 620 },
  settings: { w: 900, h: 600 },
  users: { w: 900, h: 580 },
  history: { w: 980, h: 620 },
  notifications: { w: 860, h: 600 },
  categories: { w: 820, h: 560 },
  resellers: { w: 900, h: 580 },
  customers: { w: 900, h: 580 },
  'storefront-customers': { w: 900, h: 580 },
  reviews: { w: 900, h: 580 },
  roles: { w: 900, h: 580 },
  'role-permissions': { w: 1000, h: 620 },
  modules: { w: 900, h: 580 },
  menus: { w: 900, h: 580 },
  consign: { w: 980, h: 620 },
  'consign-opname': { w: 980, h: 620 },
  'consign-journal': { w: 980, h: 620 },
  'stall-own': { w: 980, h: 620 },
  'stall-pos': { w: 1080, h: 640 },
  'stall-sales-report': { w: 980, h: 620 },
  'admin-fee': { w: 980, h: 620 },
  'tagihan-admin-fee': { w: 900, h: 580 },
};
// Ukuran minimum per tab. Kasir memakai breakpoint viewport (grid katalog + panel 400px), jadi jendela yang terlalu
// sempit membuat katalog hilang.
export const MIN_SIZES: Record<string, { w: number; h: number }> = { pos: { w: 820, h: 480 }, consignment: { w: 720, h: 420 }, 'mitra-report': { w: 640, h: 380 }, 'finance-report': { w: 720, h: 420 }, suppliers: { w: 640, h: 380 }, materials: { w: 720, h: 420 }, 'purchase-orders': { w: 720, h: 420 }, 'goods-receipts': { w: 720, h: 420 },
  stock: { w: 720, h: 420 }, production: { w: 720, h: 420 }, 'product-report': { w: 720, h: 420 }, capital: { w: 640, h: 380 },
  'po-report': { w: 720, h: 420 }, 'gr-report': { w: 720, h: 420 }, 'opname-report': { w: 720, h: 420 }, 'stock-report': { w: 720, h: 420 }, 'stall-report': { w: 720, h: 420 }, settings: { w: 640, h: 400 }, users: { w: 640, h: 400 }, history: { w: 720, h: 420 }, notifications: { w: 640, h: 400 }, categories: { w: 640, h: 400 }, resellers: { w: 640, h: 400 }, customers: { w: 640, h: 400 },
  'storefront-customers': { w: 640, h: 400 }, reviews: { w: 640, h: 400 }, roles: { w: 640, h: 400 }, 'role-permissions': { w: 720, h: 420 }, modules: { w: 640, h: 400 }, menus: { w: 640, h: 400 }, consign: { w: 720, h: 420 }, 'consign-opname': { w: 720, h: 420 }, 'consign-journal': { w: 720, h: 420 }, 'stall-own': { w: 720, h: 420 }, 'stall-sales-report': { w: 720, h: 420 }, 'stall-pos': { w: 820, h: 520 }, 'admin-fee': { w: 720, h: 420 }, 'tagihan-admin-fee': { w: 640, h: 400 } };
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

// Ubah ukuran dari salah satu dari 8 arah. Tepi yang berlawanan tetap di tempat (tepi atas/kiri menggeser posisi sambil mengubah ukuran),
// ukuran tidak turun di bawah minimum (jendela tidak "terdorong"), dan tepi tidak keluar dari area kerja (bawah taskbar/dock/menu bar).
// Jendela yang sudah sebagian di luar area tidak melompat: batasnya longgar sebatas posisinya sekarang.
export function resizeRect(edge: ResizeEdge, o: { x: number; y: number; w: number; h: number }, dx: number, dy: number, a: WinArea, min: { w: number; h: number }) {
  const minW = Math.min(min.w, a.w), minH = Math.min(min.h, usableHeight(a));
  let left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
  const bound = (lo: number, v: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  if (edge.includes('e')) right = bound(o.x + minW, o.x + o.w + dx, Math.max(a.w, o.x + o.w));
  if (edge.includes('w')) left = bound(Math.min(0, o.x), o.x + dx, o.x + o.w - minW);
  if (edge.includes('s')) bottom = bound(o.y + minH, o.y + o.h + dy, Math.max(a.h - a.bottom, o.y + o.h));
  if (edge.includes('n')) top = bound(Math.min(a.top, o.y), o.y + dy, o.y + o.h - minH);
  return { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) };
}

// Rect tempel: kiri/kanan = setengah lebar area kerja, tinggi penuh area kerja (di antara menu bar dan taskbar/dock); atas = area penuh.
export function snapRect(side: SnapSide, a: WinArea, min: { w: number; h: number }) {
  const h = usableHeight(a);
  if (side === 'top') return { x: 0, y: a.top, w: a.w, h };
  const w = Math.min(a.w, Math.max(Math.floor(a.w / 2), Math.min(min.w, a.w)));
  return { x: side === 'left' ? 0 : a.w - w, y: a.top, w, h };
}

// Sisi tempel dari posisi pointer saat menyeret titlebar: dalam 8px dari tepi atas area kerja (maksimal) atau tepi kiri/kanan layar.
export const SNAP_EDGE_PX = 8;
export function snapSideAt(px: number, py: number, a: WinArea): SnapSide | null {
  if (py <= a.top + SNAP_EDGE_PX) return 'top';
  if (px <= SNAP_EDGE_PX) return 'left';
  if (px >= a.w - SNAP_EDGE_PX) return 'right';
  return null;
}

// Rect "normal" jendela (yang dipulihkan): sebelum tempel bila sedang tertempel, selain itu x/y/w/h-nya sendiri (jendela maksimal menyimpannya).
export const normalRect = (w: WinState) => (w.restore ?? w.desired ?? { x: w.x, y: w.y, w: w.w, h: w.h });
const desiredOf = (w: WinState) => w.desired ?? { x: w.x, y: w.y, w: w.w, h: w.h };

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
      const r = a.rect ? fitRect(a.rect, s.area, minSizeFor(a.tabId)) : cascadeRect(a.tabId, s.windows.length, s.area, a.size);
      const win: WinState = { tabId: a.tabId, ...r, z, minimized: false, maximized: false, ...(a.rect ? { desired: a.rect } : {}) };
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
    case 'snap': {
      const w = byTab(s, a.tabId);
      if (!w) return s;
      const z = s.zTop + 1;
      // Rect pemulihan = rect sebelum drag dimulai bila diberikan (`from`); selama drag jendela sudah ikut bergeser ke tepi, jadi state sekarang bukan acuannya.
      const base = a.from ?? normalRect(w);
      if (a.side === 'top') return { ...update(s, a.tabId, { ...fitRect(base, s.area, minSizeFor(a.tabId)), desired: base, restore: undefined, snapped: undefined, maximized: true, minimized: false, z }), zTop: z };
      const r = snapRect(a.side, s.area, minSizeFor(a.tabId));
      return { ...update(s, a.tabId, { ...r, restore: base, desired: undefined, snapped: a.side, maximized: false, minimized: false, z }), zTop: z };
    }
    case 'restoreAt': {
      const w = byTab(s, a.tabId);
      if (!w || (!w.maximized && !w.snapped)) return s;
      const base = normalRect(w);
      const r = clampRect({ x: a.x, y: a.y, w: base.w, h: base.h }, s.area, minSizeFor(a.tabId));
      return update(s, a.tabId, { ...r, desired: { x: r.x, y: r.y, w: base.w, h: base.h }, restore: undefined, snapped: undefined, maximized: false });
    }
    case 'settle':
      return byTab(s, a.tabId) ? { ...s } : s;
    case 'close': {
      if (!byTab(s, a.tabId)) return s;
      return { ...s, windows: s.windows.filter(w => w.tabId !== a.tabId) };
    }
    case 'move': {
      const w = byTab(s, a.tabId);
      if (!w || w.maximized) return s;
      const r = clampRect({ x: a.x, y: a.y, w: w.w, h: w.h }, s.area, minSizeFor(a.tabId));
      if (r.x === w.x && r.y === w.y) return s;
      const dz = desiredOf(w);
      return update(s, a.tabId, { x: r.x, y: r.y, desired: { x: r.x, y: r.y, w: dz.w, h: dz.h }, snapped: undefined, restore: undefined });
    }
    case 'resize': {
      const w = byTab(s, a.tabId);
      if (!w || w.maximized) return s;
      const r = clampRect({ x: a.x, y: a.y, w: a.w, h: a.h }, s.area, minSizeFor(a.tabId));
      // Tepi bawah tidak boleh masuk ke bawah taskbar/dock (pegangan jadi tak terjangkau).
      const h = Math.max(Math.min(minSizeFor(a.tabId).h, usableHeight(s.area)), Math.min(r.h, s.area.h - s.area.bottom - r.y));
      return update(s, a.tabId, { ...r, h, desired: { ...r, h }, snapped: undefined, restore: undefined });
    }
    case 'arrange': {
      // Susun ulang semua jendela berjenjang sesuai urutan buka; z mengikuti urutan itu, yang terakhir di atas.
      let z = s.zTop;
      const windows = s.windows.map((w, i) => {
        z += 1;
        return { ...w, ...cascadeRect(w.tabId, i, s.area), maximized: false, snapped: undefined, restore: undefined, desired: undefined, z };
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
        windows: s.windows.map(w => w.snapped
          ? { ...w, ...snapRect(w.snapped === 'top' ? 'left' : w.snapped, n, minSizeFor(w.tabId)) }   // restore (rect diinginkan) tidak ikut dijepit
          : { ...w, ...fitRect(desiredOf(w), n, minSizeFor(w.tabId)) }),
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
