// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData, useDataRevision } from '@/lib/data-sync';

// Seksi anak diganti tiruan: tombol "tulis" memanggil props.reload (titik pusat pasca-penulisan), "kategori" menampilkan data.categories.
vi.mock('./titip-jual/ProductsSection', () => ({
  default: (p: { reload: () => Promise<void>; data: { categories: { id: string }[] } }) => (
    <div><button id="write" onClick={() => { void p.reload(); }}>tulis</button><span id="cats">{p.data.categories.map(c => c.id).join(',')}</span></div>
  ),
}));
vi.mock('./titip-jual/ConsignorsSection', () => ({ default: () => null }));
vi.mock('./titip-jual/StallsSection', () => ({ default: () => null }));
vi.mock('./titip-jual/StockSection', () => ({ default: () => null }));
vi.mock('./titip-jual/ReceiptsSection', () => ({ default: () => null }));
vi.mock('./titip-jual/SettlementsSection', () => ({ default: () => null }));
vi.mock('./titip-jual/AdjustmentsSection', () => ({
  default: (p: { reload: () => Promise<void> }) => <button id="write-opname" onClick={() => { void p.reload(); }}>tulis opname</button>,
}));
vi.mock('./titip-jual/WalletOverview', () => ({ default: () => null }));

import TitipJualTab from './TitipJualTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cats = [{ id: 'k1' }];
const calls: Record<string, number> = {};
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  cats = [{ id: 'k1' }];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls[path] = (calls[path] ?? 0) + 1;
    const body = path === '/api/categories' ? { categories: cats } : path === '/api/stalls' ? { stalls: [] } : path === '/api/consignors' ? { consignors: [] }
      : path === '/api/consign/products' ? { products: [], stallItems: [] } : path === '/api/warehouses' ? { warehouses: [] } : path === '/api/master-banks' ? { banks: [] }
      : path === '/api/stalls/assignable-users' ? { users: [] } : {};
    return { ok: true, json: async () => body };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const revSeen: number[] = [];
function Reader() { const r = useDataRevision('consign'); useEffect(() => { revSeen.push(r); }, [r]); return null; }
function CatWriter() { const bump = useBumpData(); return <button id="catbump" onClick={() => bump('categories', 'categories-tab')}>c</button>; }

const render = (ui: ReactNode) => act(async () => { root.render(ui); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 250)); });
const tab = (enabled: boolean) => (
  <DataSyncProvider enabled={enabled}><CatWriter /><Reader /><TitipJualTab creds="x" mode="main" can={() => true} /></DataSyncProvider>
);

describe('TitipJualTab: sinkron data (domain consign dan kategori)', () => {
  beforeEach(() => { revSeen.length = 0; });

  it('mode jendela: mutasi memuat ulang data tab sekali dan mem-bump domain consign sekali (pembaca naik satu kali)', async () => {
    await render(tab(true)); await settle();
    expect(calls['/api/stalls']).toBe(1);
    await act(async () => { document.getElementById('write')!.click(); });
    await settle();
    expect(calls['/api/stalls']).toBe(2);            // reload sendiri, tidak berulang
    expect(revSeen).toEqual([0, 1]);
  });

  it('Klasik (provider enabled=false): mutasi tetap memuat ulang tab, tetapi tidak ada bump (revisi tetap 0)', async () => {
    await render(tab(false)); await settle();
    await act(async () => { document.getElementById('write')!.click(); });
    await settle();
    expect(calls['/api/stalls']).toBe(2);
    expect(revSeen).toEqual([0]);
  });

  it('kategori diubah di jendela lain: hanya /api/categories dimuat ulang, data lain tidak disentuh, tanpa spinner penuh', async () => {
    await render(tab(true)); await settle();
    expect(document.getElementById('cats')!.textContent).toBe('k1');
    cats = [{ id: 'k1' }, { id: 'k2' }];
    await act(async () => { document.getElementById('catbump')!.click(); });
    await settle();
    expect(calls['/api/categories']).toBe(2);
    expect(calls['/api/stalls']).toBe(1);
    expect(document.getElementById('cats')!.textContent).toBe('k1,k2');
  });
});

describe('dua jendela TitipJualTab (main dan opname) ter-mount bersamaan', () => {
  beforeEach(() => { revSeen.length = 0; });
  const both = (
    <DataSyncProvider enabled>
      <Reader />
      <div id="main"><TitipJualTab creds="x" mode="main" can={() => true} /></div>
      <div id="opname"><TitipJualTab creds="x" mode="opname" can={() => true} /></div>
    </DataSyncProvider>
  );

  it('tidak tertukar: tiap instance menampilkan seksi sesuai modenya', async () => {
    await render(both); await settle();
    expect(document.querySelector('#main #write')).not.toBeNull();
    expect(document.querySelector('#main #write-opname')).toBeNull();
    expect(document.querySelector('#opname #write-opname')).not.toBeNull();
    expect(document.querySelector('#opname #write')).toBeNull();
  });

  it('opname menulis -> instance main menyegar sekali (dan opname memuat ulang dirinya sekali); sebaliknya juga; tidak ada loop', async () => {
    await render(both); await settle();
    expect(calls['/api/stalls']).toBe(2);                       // 1 per instance saat mount
    await act(async () => { document.getElementById('write-opname')!.click(); });
    await settle();
    expect(calls['/api/stalls']).toBe(4);                       // opname reload sendiri (+1) + main menyegar lewat bump (+1)
    await act(async () => { document.getElementById('write')!.click(); });
    await settle();
    expect(calls['/api/stalls']).toBe(6);
    await settle();
    expect(calls['/api/stalls']).toBe(6);                       // stabil: tidak berulang
    expect(revSeen).toEqual([0, 1, 2]);                         // pembaca lain (Laporan/Analitik Lapak) naik satu kali per penulisan
  });
});
