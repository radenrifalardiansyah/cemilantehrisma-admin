'use client';

import { useEffect, useReducer, useRef } from 'react';
import { isWindowTab } from '@/lib/ui-layout';
import { focusedTabId, initialWmState, makeArea, wmReducer, type DesktopSkin } from './window-reducer';

const viewport = () => (typeof window === 'undefined' ? { w: 1280, h: 720 } : { w: window.innerWidth, h: window.innerHeight });

// State window manager + sinkronisasi ke area layar dan ke `activeTab` (sumber kebenaran tab di page.tsx).
// - area = viewport dikurangi inset skin; berubah saat layar di-resize atau skin diganti.
// - Permintaan dari luar (notifikasi, tombol "Pesanan" di Kasir, dst. memanggil setActiveTab): bila mode desktop
//   aktif dan tabnya berjendela tapi belum fokus, jendelanya dibuka/dipulihkan. Efek hanya jalan saat activeTab
//   atau status aktif berubah, atau ada permintaan navigasi baru (navNonce, mis. notifikasi ke tab yang sama dengan
//   activeTab tapi jendelanya sudah ditutup) — BUKAN saat state jendela berubah, supaya menutup jendela terakhir
//   tidak membukanya lagi.
export function useWindowManager(opts: { enabled: boolean; skin: DesktopSkin; activeTab: string; navNonce?: number }) {
  const { enabled, skin, activeTab, navNonce = 0 } = opts;
  const [wm, dispatch] = useReducer(wmReducer, undefined, () => { const v = viewport(); return initialWmState(makeArea(v.w, v.h, skin)); });

  const wmRef = useRef(wm);
  useEffect(() => { wmRef.current = wm; });

  useEffect(() => {
    if (!enabled) return; // pengguna Klasik: tidak memasang listener resize sama sekali
    const apply = () => { const v = viewport(); dispatch({ type: 'setArea', area: makeArea(v.w, v.h, skin) }); };
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
  }, [enabled, activeTab, navNonce]);

  return { wm, dispatch };
}
