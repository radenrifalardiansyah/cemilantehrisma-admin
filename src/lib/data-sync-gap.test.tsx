// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import ConfirmProvider from '@/components/Confirm';
import { DataSyncProvider, useBumpData, useDataRevision, type DataDomain } from '@/lib/data-sync';
import StockTab from '@/components/tabs/StockTab';
import ProductionTab from '@/components/tabs/ProductionTab';
import ExpensesTab from '@/components/tabs/ExpensesTab';
import CapitalTab from '@/components/tabs/CapitalTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Menutup celah sinkron tahap 23A: tiap domain punya pasangan penulis-pembaca yang dibuktikan di sini dengan tab NYATA dan fetch di-mock.
const calls: Record<string, number> = {};
let failing = new Set<string>();
let capitalDeleteOk = true;
let host: HTMLDivElement; let root: Root;

const bodies: Record<string, unknown> = {
  '/api/warehouses': { warehouses: [{ id: 'w1', name: 'Gudang Utama', location: '', description: '' }] },
  '/api/warehouses/w1/stock': { stocks: [{ productId: 'p1', productName: 'Keripik', stockQty: 5 }] },
  '/api/stock': { entries: [] },
  '/api/materials': { materials: [{ id: 'm1', name: 'Tepung', unit: 'kg', stockQty: 10, price: 1000 }] },
  '/api/production': { batches: [] },
  '/api/expenses': { expenses: [{ id: 'e1', category: 'Bahan Baku', description: 'Bayar hutang X', amount: 1000, date: '2026-11-25', note: '', items: [{ description: 'Bayar hutang X', amount: 1000 }] }] },
  '/api/capital': { entries: [{ id: 'c1', type: 'modal', amount: 5000, date: '2026-11-25', note: '', walletId: null }] },
  '/api/wallets': { wallets: [] },
  '/api/wallets/balances': { balances: {} },
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const k of Object.keys(calls)) delete calls[k];
  failing = new Set(); capitalDeleteOk = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/?]+/, '').split('?')[0];
    const method = init?.method ?? 'GET';
    calls[`${method} ${path}`] = (calls[`${method} ${path}`] ?? 0) + 1;
    if (method === 'DELETE' && path.startsWith('/api/capital/')) return { ok: capitalDeleteOk, json: async () => ({}) };
    if (failing.has(path)) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => bodies[path] ?? {} };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const revSeen: Record<string, number[]> = {};
function Probe({ domain }: { domain: DataDomain }) { const r = useDataRevision(domain); useEffect(() => { (revSeen[domain] ??= []).push(r); }, [domain, r]); return null; }
function Other({ domain }: { domain: DataDomain }) { const bump = useBumpData(); return <button id="other" onClick={() => bump(domain, 'tab-lain')}>b</button>; }
const wrap = (enabled: boolean, domain: DataDomain, tab: ReactNode): ReactNode => (
  <ToastProvider><ConfirmProvider><DataSyncProvider enabled={enabled}><Probe domain={domain} /><Other domain={domain} />{tab}</DataSyncProvider></ConfirmProvider></ToastProvider>
);
const render = (n: ReactNode) => act(async () => { root.render(n); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const other = () => document.getElementById('other');

describe('Gudang (StockTab): pembaca domain products dan procurement', () => {
  const tab = <StockTab creds="x" products={[]} categories={[]} />;
  beforeEach(() => { for (const k of Object.keys(revSeen)) delete revSeen[k]; });

  it('bump products: daftar gudang dimuat ulang sekali, senyap (tanpa spinner penuh)', async () => {
    await render(wrap(true, 'products', tab)); await settle();
    const before = calls['GET /api/warehouses'];
    expect(before).toBeGreaterThanOrEqual(1);
    await click(other()); await settle();
    expect(calls['GET /api/warehouses']).toBe(before + 1);
    expect(document.body.textContent).toContain('Gudang Utama');
  });
  it('bump procurement juga memuat ulang; gagal sesaat mempertahankan tampilan lama', async () => {
    await render(wrap(true, 'procurement', tab)); await settle();
    failing.add('/api/warehouses');
    const before = calls['GET /api/warehouses'];
    await click(other()); await settle();
    expect(calls['GET /api/warehouses']).toBe(before + 1);
    expect(document.body.textContent).toContain('Gudang Utama');
  });
  it('Klasik (enabled=false): bump tidak memicu fetch tambahan', async () => {
    await render(wrap(false, 'products', tab)); await settle();
    const before = calls['GET /api/warehouses'];
    await click(other()); await settle();
    expect(calls['GET /api/warehouses']).toBe(before);
  });
});

describe('Produksi (ProductionTab): pembaca domain procurement (daftar bahan baku)', () => {
  const tab = <ProductionTab creds="x" products={[]} />;
  it('bump procurement: bahan baku dimuat ulang sekali; gagal tidak mengosongkan; Klasik tidak memuat ulang', async () => {
    await render(wrap(true, 'procurement', tab)); await settle();
    const before = calls['GET /api/materials'];
    await click(other()); await settle();
    expect(calls['GET /api/materials']).toBe(before + 1);
    failing.add('/api/materials');
    await click(other()); await settle();
    expect(calls['GET /api/materials']).toBe(before + 2);
    expect(document.body.textContent).not.toContain('Memuat');
  });
  it('Klasik: tidak ada fetch bahan tambahan', async () => {
    await render(wrap(false, 'procurement', tab)); await settle();
    const before = calls['GET /api/materials'];
    await click(other()); await settle();
    expect(calls['GET /api/materials']).toBe(before);
  });
});

describe('Pengeluaran (ExpensesTab): pembaca domain wallets', () => {
  const tab = <ExpensesTab creds="x" />;
  it('bump wallets: daftar pengeluaran dimuat ulang sekali, tanpa menghapus daftar; gagal mempertahankan daftar lama', async () => {
    await render(wrap(true, 'wallets', tab)); await settle();
    expect(document.body.textContent).toContain('Bayar hutang X');
    const before = calls['GET /api/expenses'];
    await click(other()); await settle();
    expect(calls['GET /api/expenses']).toBe(before + 1);
    failing.add('/api/expenses');
    await click(other()); await settle();
    expect(calls['GET /api/expenses']).toBe(before + 2);
    expect(document.body.textContent).toContain('Bayar hutang X');
  });
  it('Klasik: tidak ada fetch pengeluaran tambahan', async () => {
    await render(wrap(false, 'wallets', tab)); await settle();
    const before = calls['GET /api/expenses'];
    await click(other()); await settle();
    expect(calls['GET /api/expenses']).toBe(before);
  });
});

describe('Modal (CapitalTab): penulis domain wallets', () => {
  const tab = <CapitalTab creds="x" />;
  const del = async () => {
    const trash = Array.from(document.querySelectorAll('button')).find(b => b.querySelector('svg.lucide-trash2, svg.lucide-trash-2') && !b.hasAttribute('aria-label'));
    await click(trash ?? null);
    const confirmBtn = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(b => /hapus|ya/i.test(b.textContent ?? '') && !/batal/i.test(b.textContent ?? ''));
    await click(confirmBtn ?? null); await settle();
  };
  beforeEach(() => { for (const k of Object.keys(revSeen)) delete revSeen[k]; });

  it('hapus berhasil mem-bump wallets sekali; hapus gagal tidak mem-bump', async () => {
    await render(wrap(true, 'wallets', tab)); await settle();
    capitalDeleteOk = false;
    await del();
    expect(calls['DELETE /api/capital/c1']).toBe(1);
    expect(revSeen.wallets).toEqual([0]);
    capitalDeleteOk = true;
    await del();
    expect(calls['DELETE /api/capital/c1']).toBe(2);
    expect(revSeen.wallets).toEqual([0, 1]);
  });
  it('Klasik: hapus berhasil tidak mem-bump (revisi tetap 0)', async () => {
    await render(wrap(false, 'wallets', tab)); await settle();
    await del();
    expect(calls['DELETE /api/capital/c1']).toBe(1);
    expect(revSeen.wallets).toEqual([0]);
  });
});
