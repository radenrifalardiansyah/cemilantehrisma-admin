// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import ConfirmProvider from '@/components/Confirm';
import { DataSyncProvider, useBumpData, useDataRevision, type DataDomain } from '@/lib/data-sync';
import ProductionTab from '@/components/tabs/ProductionTab';
import ExpensesTab from '@/components/tabs/ExpensesTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Tes review tahap 23A (Aisha): bump ProductionTab (di finally) hanya pada penghapusan BERHASIL, dan ExpensesTab tidak boleh
// membuat spinner penuh tersangkut saat muat ulang senyap menggantikan muat awal yang masih berjalan.
const calls: Record<string, number> = {};
let deleteOk = true;
let expensesGate: Promise<void> | null = null;
let expensesFailAfterFirst = false;
let host: HTMLDivElement; let root: Root;

const bodies: Record<string, unknown> = {
  '/api/warehouses': { warehouses: [{ id: 'w1', name: 'Gudang Utama', location: '', description: '' }] },
  '/api/materials': { materials: [{ id: 'm1', name: 'Tepung', unit: 'kg', stockQty: 10, price: 1000 }] },
  '/api/production': { batches: [{ id: 'b1', materialsUsed: [], materialCost: 0, otherCost: 0, totalCost: 0, costPerPcs: 0, date: '2026-11-25', outputs: [{ productId: 'p1', productName: 'Keripik Pedas', yieldQty: 5 }], totalYieldQty: 5, warehouseId: 'w1', warehouseName: 'Gudang Utama' }] },
  '/api/wallets': { wallets: [] },
  '/api/wallets/balances': { balances: {} },
  '/api/expenses': { expenses: [{ id: 'e1', category: 'Bahan Baku', description: 'Bayar hutang X', amount: 1000, date: '2026-11-25', note: '', items: [{ description: 'Bayar hutang X', amount: 1000 }] }] },
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const k of Object.keys(calls)) delete calls[k];
  deleteOk = true; expensesGate = null; expensesFailAfterFirst = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/?]+/, '').split('?')[0];
    const method = init?.method ?? 'GET';
    const key = `${method} ${path}`;
    calls[key] = (calls[key] ?? 0) + 1;
    if (method === 'DELETE' && path === '/api/production/b1') return { ok: deleteOk, status: deleteOk ? 200 : 400, json: async () => (deleteOk ? { ok: true } : { error: 'ditolak' }) };
    if (path === '/api/expenses') {
      if (calls[key] === 1 && expensesGate) await expensesGate;          // muat awal: tertahan
      else if (calls[key] > 1 && expensesFailAfterFirst) return { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => bodies[path] ?? {} };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const revSeen: Record<string, number[]> = {};
function Probe({ domain }: { domain: DataDomain }) { const r = useDataRevision(domain); useEffect(() => { (revSeen[domain] ??= []).push(r); }, [domain, r]); return null; }
function Other({ domain }: { domain: DataDomain }) { const bump = useBumpData(); return <button id="other" onClick={() => bump(domain, 'tab-lain')}>b</button>; }
const wrap = (enabled: boolean, domains: DataDomain[], tab: ReactNode): ReactNode => (
  <ToastProvider><ConfirmProvider><DataSyncProvider enabled={enabled}>
    {domains.map(d => <Probe key={d} domain={d} />)}<Other domain={domains[0]} />{tab}
  </DataSyncProvider></ConfirmProvider></ToastProvider>
);
const render = (n: ReactNode) => act(async () => { root.render(n); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

describe('Produksi (ProductionTab): bump di finally hanya pada hapus batch berhasil', () => {
  const tab = <ProductionTab creds="x" products={[]} />;
  const del = async () => {
    await click(document.querySelector('button[title="Hapus"]'));
    const confirmBtn = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(b => /hapus|ya/i.test(b.textContent ?? '') && !/batal/i.test(b.textContent ?? ''));
    await click(confirmBtn ?? null); await settle();
  };
  beforeEach(() => { for (const k of Object.keys(revSeen)) delete revSeen[k]; });

  it('hapus gagal (400): procurement dan products tidak naik; hapus berhasil: masing-masing naik sekali', async () => {
    await render(wrap(true, ['procurement', 'products'], tab)); await settle();
    expect(document.body.textContent).toContain('Keripik Pedas');
    deleteOk = false;
    await del();
    expect(calls['DELETE /api/production/b1']).toBe(1);
    expect(revSeen.procurement).toEqual([0]);
    expect(revSeen.products).toEqual([0]);
    deleteOk = true;
    await del();
    expect(calls['DELETE /api/production/b1']).toBe(2);
    expect(revSeen.procurement).toEqual([0, 1]);
    expect(revSeen.products).toEqual([0, 1]);
  });
  it('Klasik: hapus berhasil tidak mem-bump', async () => {
    await render(wrap(false, ['procurement', 'products'], tab)); await settle();
    await del();
    expect(calls['DELETE /api/production/b1']).toBe(1);
    expect(revSeen.procurement).toEqual([0]);
    expect(revSeen.products).toEqual([0]);
  });
});

describe('Pengeluaran (ExpensesTab): muat ulang senyap vs muat awal yang masih berjalan', () => {
  it('muat awal tertahan, bump datang, muat ulang senyap gagal (500): spinner penuh tidak boleh tersangkut', async () => {
    let release!: () => void;
    expensesGate = new Promise<void>(r => { release = r; });
    expensesFailAfterFirst = true;
    await render(wrap(true, ['wallets'], <ExpensesTab creds="x" />));
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    await click(document.getElementById('other'));
    await settle();                       // bump (debounce 120ms) -> muat senyap -> 500
    await act(async () => { release(); await new Promise(r => setTimeout(r, 100)); });   // muat awal selesai, tapi sudah digantikan
    await settle();
    // Harapan: daftar tampil atau minimal spinner hilang. Bug: setLoading(false) tidak pernah dipanggil.
    expect(document.body.textContent).toContain('Bayar hutang X');
  });
});
