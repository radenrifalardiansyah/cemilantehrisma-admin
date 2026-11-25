// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import ConfirmProvider from '@/components/Confirm';
import { DataSyncProvider, useBumpData, useDataRevision, type DataDomain } from '@/lib/data-sync';
import ProductionTab from '@/components/tabs/ProductionTab';
import StockTab from '@/components/tabs/StockTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: Record<string, number> = {};
let otherCost = 0;
let hold: { path: string; gate: Promise<void> } | null = null;
let host: HTMLDivElement; let root: Root;

const batch = (cost: number) => ({ id: 'b1', materialsUsed: [], materialCost: 0, otherCost: cost, totalCost: cost, costPerPcs: 0, date: '2026-11-25', outputs: [{ productId: 'p1', productName: 'Keripik Pedas', yieldQty: 5 }], totalYieldQty: 5, warehouseId: 'w1', warehouseName: 'Gudang Utama' });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const k of Object.keys(calls)) delete calls[k];
  otherCost = 0; hold = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/?]+/, '').split('?')[0];
    const method = init?.method ?? 'GET';
    calls[`${method} ${path}`] = (calls[`${method} ${path}`] ?? 0) + 1;
    if (method === 'DELETE') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (hold && hold.path === path && calls[`${method} ${path}`] > 1) await hold.gate;
    const bodies: Record<string, unknown> = {
      '/api/warehouses': { warehouses: [{ id: 'wA', name: 'Gudang A', location: '', description: '' }, { id: 'wB', name: 'Gudang B', location: '', description: '' }] },
      '/api/warehouses/wA/stock': { stocks: [{ productId: 'p1', productName: 'Produk Di Gudang A', stockQty: 5 }] },
      '/api/warehouses/wB/stock': { stocks: [{ productId: 'p2', productName: 'Produk Di Gudang B', stockQty: 7 }] },
      '/api/stock': { entries: [] },
      '/api/materials': { materials: [] },
      '/api/production': { batches: [batch(otherCost)] },
      '/api/wallets': { wallets: [] }, '/api/wallets/balances': { balances: {} },
    };
    return { ok: true, status: 200, json: async () => bodies[path] ?? {} };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const revSeen: Record<string, number[]> = {};
function Probe({ domain }: { domain: DataDomain }) { const r = useDataRevision(domain); useEffect(() => { (revSeen[domain] ??= []).push(r); }, [domain, r]); return null; }
function Other({ domain }: { domain: DataDomain }) { const bump = useBumpData(); return <button id="other" onClick={() => bump(domain, 'tab-lain')}>b</button>; }
const wrap = (domains: DataDomain[], tab: ReactNode): ReactNode => (
  <ToastProvider><ConfirmProvider><DataSyncProvider enabled>{domains.map(d => <Probe key={d} domain={d} />)}<Other domain={domains[0]} />{tab}</DataSyncProvider></ConfirmProvider></ToastProvider>
);
const render = (n: ReactNode) => act(async () => { root.render(n); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

describe('Produksi: bump wallets (Pengeluaran otomatis) hanya bila batch punya biaya lain', () => {
  const del = async () => {
    await click(document.querySelector('button[title="Hapus"]'));
    const confirmBtn = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(b => /hapus|ya/i.test(b.textContent ?? '') && !/batal/i.test(b.textContent ?? ''));
    await click(confirmBtn ?? null); await settle();
  };
  beforeEach(() => { for (const k of Object.keys(revSeen)) delete revSeen[k]; });

  it('hapus batch dengan otherCost > 0: wallets ikut naik sekali bersama procurement dan products', async () => {
    otherCost = 5000;
    await render(wrap(['procurement', 'products', 'wallets'], <ProductionTab creds="x" products={[]} />)); await settle();
    await del();
    expect(revSeen.procurement).toEqual([0, 1]); expect(revSeen.products).toEqual([0, 1]); expect(revSeen.wallets).toEqual([0, 1]);
  });
  it('hapus batch tanpa biaya lain: wallets tidak naik', async () => {
    otherCost = 0;
    await render(wrap(['procurement', 'products', 'wallets'], <ProductionTab creds="x" products={[]} />)); await settle();
    await del();
    expect(revSeen.procurement).toEqual([0, 1]); expect(revSeen.wallets).toEqual([0]);
  });
});

describe('Gudang: respons senyap terlambat untuk gudang lain tidak mengisi tampilan gudang yang dipilih sekarang', () => {
  it('muat ulang senyap gudang A tertahan, pengguna pindah ke gudang B: stok B tetap tampil', async () => {
    await render(wrap(['products'], <StockTab creds="x" products={[]} categories={[]} />)); await settle();
    const card = (name: string) => Array.from(document.querySelectorAll('.card.cursor-pointer')).find(c => c.textContent?.includes(name)) ?? null;
    await click(card('Gudang A')); await settle();
    expect(document.body.textContent).toContain('Produk Di Gudang A');
    let release!: () => void;
    hold = { path: '/api/warehouses/wA/stock', gate: new Promise<void>(r => { release = r; }) };
    await click(document.getElementById('other')); await settle();       // muat ulang senyap: stok gudang A tertahan
    await click(document.querySelector('button[title="Kembali"]')); await settle();
    await click(card('Gudang B')); await settle();
    expect(document.body.textContent).toContain('Produk Di Gudang B');
    await act(async () => { release(); await new Promise(r => setTimeout(r, 100)); });   // respons basi gudang A tiba terakhir
    expect(document.body.textContent).toContain('Produk Di Gudang B');
    expect(document.body.textContent).not.toContain('Produk Di Gudang A');
  });
});
