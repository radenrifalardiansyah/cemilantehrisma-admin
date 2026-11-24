// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import ConfirmProvider from '@/components/Confirm';
import { DataSyncProvider, useBumpData } from '@/lib/data-sync';
import IncomeTab from './IncomeTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: Record<string, number> = {};
let failing = false;
let host: HTMLDivElement; let root: Root;
const income = [{ id: 'i1', category: 'Penjualan Lapak', description: 'Setoran lapak X', amount: 50000, date: '2026-11-25', note: '', walletId: null }];

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  failing = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/?]+/, '').split('?')[0];
    calls[path] = (calls[path] ?? 0) + 1;
    if (failing && ['/api/income', '/api/orders', '/api/consignment/recap'].includes(path)) return { ok: false, status: 500, json: async () => ({}) };
    const body = path === '/api/income' ? { income } : path === '/api/orders' ? { orders: [] } : path === '/api/consignment/recap' ? { recaps: [] }
      : path === '/api/wallets' ? { wallets: [] } : path === '/api/wallets/balances' ? { balances: {} } : {};
    return { ok: true, status: 200, json: async () => body };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function Other() { const bump = useBumpData(); return <button id="other" onClick={() => bump('wallets', 'journal-tab')}>b</button>; }
const ui = (enabled: boolean): ReactNode => (
  <ToastProvider><ConfirmProvider><DataSyncProvider enabled={enabled}><Other /><IncomeTab creds="x" /></DataSyncProvider></ConfirmProvider></ToastProvider>
);
const render = (n: ReactNode) => act(async () => { root.render(n); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const click = (id: string) => act(async () => { document.getElementById(id)!.click(); });

describe('IncomeTab: muat ulang senyap saat bump wallets dari tab lain', () => {
  it('mode jendela: daftar pemasukan dimuat ulang sekali tanpa spinner penuh', async () => {
    await render(ui(true)); await settle();
    expect(calls['/api/income']).toBe(1);
    expect(document.body.textContent).toContain('Setoran lapak X');
    await click('other'); await settle();
    expect(calls['/api/income']).toBe(2);
    expect(document.body.textContent).toContain('Setoran lapak X');
  });

  it('server gagal sesaat saat muat ulang senyap: daftar lama dipertahankan', async () => {
    await render(ui(true)); await settle();
    failing = true;
    await click('other'); await settle();
    expect(calls['/api/income']).toBe(2);
    expect(document.body.textContent).toContain('Setoran lapak X');
  });

  it('Klasik (enabled=false): bump tidak memicu fetch daftar pemasukan', async () => {
    await render(ui(false)); await settle();
    await click('other'); await settle();
    expect(calls['/api/income']).toBe(1);
  });
});
