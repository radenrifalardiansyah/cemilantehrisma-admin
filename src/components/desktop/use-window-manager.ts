'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { isWindowTab } from '@/lib/ui-layout';
import { geometryKey, readGeometry, setGeometryEntry, writeGeometry, type GeometryMap } from '@/lib/window-geometry';
import { focusedTabId, initialWmState, makeArea, normalRect, wmReducer, type DesktopSkin, type WmAction } from './window-reducer';

const viewport = () => (typeof window === 'undefined' ? { w: 1280, h: 720 } : { w: window.innerWidth, h: window.innerHeight });

// State window manager + sinkronisasi ke area layar dan ke `activeTab` (sumber kebenaran tab di page.tsx).
// - area = viewport dikurangi inset skin; berubah saat layar di-resize atau skin diganti.
// - Permintaan dari luar (notifikasi, tombol "Pesanan" di Kasir, dst. memanggil setActiveTab): bila mode desktop
//   aktif dan tabnya berjendela tapi belum fokus, jendelanya dibuka/dipulihkan. Efek hanya jalan saat activeTab
//   atau status aktif berubah, atau ada permintaan navigasi baru (navNonce, mis. notifikasi ke tab yang sama dengan
//   activeTab tapi jendelanya sudah ditutup) — BUKAN saat state jendela berubah, supaya menutup jendela terakhir
//   tidak membukanya lagi.
//
// Geometri jendela diingat per pengguna dan skin (localStorage, lihat window-geometry.ts): rect normal disimpan saat geser/ubah ukuran SELESAI
// ('settle'), saat jendela ditutup, dimaksimalkan, atau ditempel. Dipakai HANYA saat jendela dibuka (dijepit ke area layar saat ini); desktop tetap
// mulai kosong. Tanpa `username` tidak ada yang dibaca/ditulis.
export function useWindowManager(opts: { enabled: boolean; skin: DesktopSkin; activeTab: string; navNonce?: number; username?: string }) {
  const { enabled, skin, activeTab, navNonce = 0, username } = opts;
  const [wm, rawDispatch] = useReducer(wmReducer, undefined, () => { const v = viewport(); return initialWmState(makeArea(v.w, v.h, skin)); });

  const wmRef = useRef(wm);
  useEffect(() => { wmRef.current = wm; });
  const cfgRef = useRef({ enabled, skin, username });
  useEffect(() => { cfgRef.current = { enabled, skin, username }; });

  // Peta geometri tersimpan (dimuat malas per kunci pengguna+skin, diperbarui di memori lalu ditulis).
  const geo = useRef<{ key: string; map: GeometryMap } | null>(null);
  const pendingSettle = useRef(new Set<string>());
  const geoFor = useCallback(() => {
    const { enabled: en, skin: sk, username: un } = cfgRef.current;
    if (!en || !un) return null;
    const key = geometryKey(un, sk);
    if (geo.current?.key !== key) geo.current = { key, map: readGeometry(un, sk, isWindowTab) };
    return geo.current;
  }, []);
  const saveRect = useCallback((tabId: string, rect: { x: number; y: number; w: number; h: number }) => {
    const g = geoFor();
    const { skin: sk, username: un } = cfgRef.current;
    if (!g || !un) return;
    g.map = setGeometryEntry(g.map, tabId, rect);
    writeGeometry(un, sk, g.map);
  }, [geoFor]);

  const dispatch = useCallback((a: WmAction) => {
    const tabId = 'tabId' in a ? a.tabId : null;
    const cur = tabId ? wmRef.current.windows.find(w => w.tabId === tabId) : undefined;
    if (a.type === 'open') {
      if (!cur && !a.rect) { const saved = geoFor()?.map[a.tabId]; if (saved) a = { ...a, rect: saved }; }
    } else if (a.type === 'close' || a.type === 'snap' || (a.type === 'maximize' && cur && !cur.maximized)) {
      if (cur && tabId) saveRect(tabId, a.type === 'snap' && a.from ? a.from : normalRect(cur));
    } else if (a.type === 'settle') {
      pendingSettle.current.add(a.tabId);
    }
    rawDispatch(a);
  }, [geoFor, saveRect]);

  // 'settle' membuat state baru -> efek ini menyimpan rect normal jendela yang baru selesai digeser/diubah ukurannya (sekali per aksi, bukan per frame).
  useEffect(() => {
    if (pendingSettle.current.size === 0) return;
    for (const id of pendingSettle.current) { const w = wm.windows.find(x => x.tabId === id); if (w) saveRect(id, normalRect(w)); }
    pendingSettle.current.clear();
  }, [wm, saveRect]);

  useEffect(() => {
    if (!enabled) return; // pengguna Klasik: tidak memasang listener resize sama sekali
    const apply = () => { const v = viewport(); rawDispatch({ type: 'setArea', area: makeArea(v.w, v.h, skin) }); };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [enabled, skin]);

  // Aktivasi pertama mode desktop (reload, layout baru di-hydrate, pindah Klasik -> Desktop karena resize/ganti tampilan)
  // TIDAK membuka jendela apa pun: desktop mulai kosong meski activeTab awal 'dashboard'. Hanya permintaan SESUDAH itu
  // (klik menu/ikon, notifikasi lewat navNonce, activeTab berubah) yang membuka jendela.
  // Tahan efek ganda (StrictMode): yang disimpan adalah activeTab/navNonce saat aktivasi, bukan "efek sudah jalan sekali".
  // Jendela dibuka hanya bila nilai itu berbeda (atau sudah pernah ada permintaan sesudah aktivasi: armed).
  const activation = useRef<{ tab: string; nonce: number; armed: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) { activation.current = null; return; }
    if (!activation.current) activation.current = { tab: activeTab, nonce: navNonce, armed: false };
    const a = activation.current;
    if (!a.armed && a.tab === activeTab && a.nonce === navNonce) return;
    a.armed = true;
    if (!isWindowTab(activeTab)) return;
    if (focusedTabId(wmRef.current) === activeTab) return;
    dispatch({ type: 'open', tabId: activeTab });
  }, [enabled, activeTab, navNonce, dispatch]);

  return { wm, dispatch };
}
