// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData } from '@/lib/data-sync';

// Seksi anak ditiru: menampilkan daftar lapak yang diterima lewat props (bukti tab memuat ulang daftar lapak).
vi.mock('./stall-own/ShipmentsSection', () => ({
  default: (p: { stalls: { id: string }[] }) => <span id="shipments">{p.stalls.map(s => s.id).join(',')}</span>,
}));
vi.mock('./stall-own/PricesSection', () => ({ default: () => <span id="prices" /> }));
vi.mock('./stall-own/SettlementsSection', () => ({ default: () => <span id="settlements" /> }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/lib/pdf/useStoreHeader', () => ({ useStoreHeader: () => ({}) }));

import StallOwnTab from './StallOwnTab';
import CashierSalesReportTab from './CashierSalesReportTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stalls = [{ id: 's1' }];
const calls: Record<string, number> = {};
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  stalls = [{ id: 's1' }];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    calls[path] = (calls[path] ?? 0) + 1;
    const body = path === '/api/stalls' ? { stalls } : path === '/api/warehouses' ? { warehouses: [] }
      : path === '/api/stall-pos/cashier-report' ? { stalls: [], names: {}, summary: { count: 0, revenue: 0, discount: 0 }, cashiers: [], shifts: [] } : {};
    return { ok: true, json: async () => body };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function Bumper() {
  const bump = useBumpData();
  return (<>
    <button id="other" onClick={() => bump('consign', 'titip-jual-tab:main')}>lain</button>
    <button id="self" onClick={() => bump('consign', 'stall-own-tab')}>sendiri</button>
  </>);
}
const render = (ui: ReactNode) => act(async () => { root.render(ui); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 250)); });
const click = (id: string) => act(async () => { document.getElementById(id)!.click(); });

describe('StallOwnTab: sinkron daftar lapak (domain consign)', () => {
  const ui = (enabled: boolean) => (
    <DataSyncProvider enabled={enabled}><Bumper /><StallOwnTab creds="x" can={() => true} /></DataSyncProvider>
  );

  it('mode jendela: bump consign dari jendela lain memuat ulang daftar lapak sekali, tanpa spinner dan tanpa mengganti sub-tab', async () => {
    await render(ui(true)); await settle();
    expect(calls['/api/stalls']).toBe(1);
    expect(document.getElementById('shipments')!.textContent).toBe('s1');
    await act(async () => { (document.querySelector('button[aria-label="Harga di Lapak"]') as HTMLButtonElement).click(); });
    expect(document.getElementById('prices')).not.toBeNull();
    stalls = [{ id: 's1' }, { id: 's2' }];
    await click('other'); await settle();
    expect(calls['/api/stalls']).toBe(2);
    expect(document.getElementById('prices')).not.toBeNull();   // sub-tab tetap
    expect(document.body.textContent).not.toContain('Memuat');
  });

  it('bump dari tab ini sendiri tidak memuat ulang; Klasik (enabled=false) tidak memuat ulang', async () => {
    await render(ui(true)); await settle();
    await click('self'); await settle();
    expect(calls['/api/stalls']).toBe(1);
    act(() => root.unmount()); root = createRoot(host);
    for (const k of Object.keys(calls)) delete calls[k];
    await render(ui(false)); await settle();
    await click('other'); await settle();
    expect(calls['/api/stalls']).toBe(1);
  });
});

describe('CashierSalesReportTab: sinkron laporan (domain consign)', () => {
  const ui = (enabled: boolean) => (
    <DataSyncProvider enabled={enabled}><Bumper /><CashierSalesReportTab creds="x" /></DataSyncProvider>
  );
  it('mode jendela: bump consign memuat ulang laporan sekali; Klasik tidak', async () => {
    await render(ui(true)); await settle();
    expect(calls['/api/stall-pos/cashier-report']).toBe(1);
    await click('other'); await settle();
    expect(calls['/api/stall-pos/cashier-report']).toBe(2);
    act(() => root.unmount()); root = createRoot(host);
    for (const k of Object.keys(calls)) delete calls[k];
    await render(ui(false)); await settle();
    await click('other'); await settle();
    expect(calls['/api/stall-pos/cashier-report']).toBe(1);
  });
});
