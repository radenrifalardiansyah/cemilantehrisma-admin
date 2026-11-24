'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Sinyal revisi per domain data untuk MODE JENDELA. Di mode Klasik hanya satu tab ter-mount, jadi pindah tab me-remount dan
// memuat ulang datanya. Di mode jendela beberapa tab ter-mount bersamaan, sehingga tab yang memuat datanya saat mount tidak
// tahu bahwa tab lain mengubah data. Penulis memanggil bump(domain) setelah penulisan BERHASIL; pembaca memuat ulang saat
// revisi berubah. Tanpa provider / di Klasik (enabled=false): bump no-op, revisi tetap 0 -> tidak ada fetch tambahan.
export type DataDomain = 'products' | 'categories' | 'procurement' | 'wallets' | 'customers' | 'roles';

type Revs = Record<DataDomain, number>;
type Srcs = Record<DataDomain, string | null>;
interface Ctx { rev: Revs; src: Srcs; bump: (domain: DataDomain, source?: string) => void }

const ZERO: Revs = { products: 0, categories: 0, procurement: 0, wallets: 0, customers: 0, roles: 0 };
const NO_SRC: Srcs = { products: null, categories: null, procurement: null, wallets: null, customers: null, roles: null };
const BUMP_DEBOUNCE_MS = 120;
const NOOP = () => {};

const DataSyncContext = createContext<Ctx | null>(null);

export function DataSyncProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<{ rev: Revs; src: Srcs }>({ rev: ZERO, src: NO_SRC });
  const pending = useRef(new Map<DataDomain, string | null>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Bump beruntun digabung: satu kenaikan per domain per jendela waktu. Bila sumbernya berbeda, sumber dikosongkan
  // ('*') sehingga tidak ada pembaca yang melewatkan segarkan.
  const realBump = useCallback((domain: DataDomain, source?: string) => {
    const s = source ?? '*';
    const prev = pending.current.get(domain);
    pending.current.set(domain, prev === undefined || prev === s ? s : '*');
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const batch = pending.current;
      pending.current = new Map();
      setState(st => {
        const rev = { ...st.rev }; const src = { ...st.src };
        for (const [d, s2] of batch) { rev[d] += 1; src[d] = s2; }
        return { rev, src };
      });
    }, BUMP_DEBOUNCE_MS);
  }, []);

  // Nilai konteks berubah (bukan struktur pohon) saat enabled berganti: tidak ada remount. Revisi yang sudah naik tetap
  // terlihat (tab yang di-mount belakangan memakainya sebagai dasar), hanya bump yang dimatikan di Klasik.
  const value = useMemo<Ctx>(() => ({ rev: state.rev, src: state.src, bump: enabled ? realBump : NOOP }), [state, enabled, realBump]);
  return <DataSyncContext.Provider value={value}>{children}</DataSyncContext.Provider>;
}

/** Penulis: panggil setelah penulisan berhasil. `source` = id penulis supaya ia tidak memuat ulang dirinya sendiri. */
export function useBumpData() {
  return useContext(DataSyncContext)?.bump ?? NOOP;
}

/** Angka revisi domain (0 tanpa provider / belum ada bump). */
export function useDataRevision(domain: DataDomain): number {
  return useContext(DataSyncContext)?.rev[domain] ?? 0;
}

/**
 * Pembaca: panggil `reload` saat revisi domain berubah SETELAH mount (revisi saat mount dilewati karena data dimuat saat mount).
 * Bila bump berasal dari `selfId`, dilewati (penulis sudah memuat ulang sendiri).
 */
export function useOnDataRevision(domain: DataDomain, reload: () => void, selfId?: string) {
  const ctx = useContext(DataSyncContext);
  const rev = ctx?.rev[domain] ?? 0;
  const src = ctx?.src[domain] ?? null;
  const seen = useRef(rev);
  const fn = useRef(reload);
  useEffect(() => { fn.current = reload; });
  useEffect(() => {
    if (rev === seen.current) return;
    seen.current = rev;
    if (selfId !== undefined && src === selfId) return;
    fn.current();
  }, [rev, src, selfId]);
}
