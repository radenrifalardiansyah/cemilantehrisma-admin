// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData } from '@/lib/data-sync';

vi.mock('../titip-jual/DataList', () => ({ default: () => null, DetailPanel: () => null }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/components/Confirm', () => ({ useConfirm: () => async () => true }));

import SettlementsSection from './SettlementsSection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let previewTotal = 100;
let previewOk = true;
const calls: Record<string, number> = {};
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  previewTotal = 100; previewOk = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    calls[path] = (calls[path] ?? 0) + 1;
    if (path === '/api/stall-own/settlements') return { ok: true, json: async () => ({ settlements: [], payables: [{ stallId: 's1', amount: 100, lines: 1, firstDate: '2026-11-01', lastDate: '2026-11-01' }] }) };
    if (path === '/api/stall-own/settlements/preview') {
      return { ok: previewOk, json: async () => ({ items: [{ productId: 'p1', productName: 'Teh', qty: 1, amount: previewTotal }], total: previewTotal, count: 1 }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function Bumper() {
  const bump = useBumpData();
  return (<>
    <button id="other" onClick={() => bump('consign', 'kasir-lapak')}>lain</button>
    <button id="self" onClick={() => bump('consign', 'stall-own-tab')}>sendiri</button>
  </>);
}
const stalls = [{ id: 's1', name: 'Lapak 1', code: 'L1', isActive: true }] as never;
const ui = (enabled: boolean): ReactNode => (
  <DataSyncProvider enabled={enabled}><Bumper /><SettlementsSection creds="x" stalls={stalls} warehouses={[]} can={() => true} /></DataSyncProvider>
);
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 250)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const openModal = async () => {
  await settle();
  await click([...document.querySelectorAll('button')].find(b => b.textContent === 'Buat Setoran') ?? null);
  await settle();
};

describe('Setoran Lapak: preview menyegar senyap saat consign berubah', () => {
  it('mode jendela: bump dari jendela lain memuat ulang preview sekali; bump sendiri tidak; preview lama bertahan bila gagal', async () => {
    await act(async () => { root.render(ui(true)); });
    await openModal();
    expect(calls['/api/stall-own/settlements/preview']).toBe(1);
    expect(document.body.textContent).toContain('Teh');
    previewTotal = 250;
    await click(document.getElementById('other')); await settle();
    expect(calls['/api/stall-own/settlements/preview']).toBe(2);
    expect(document.body.textContent).toContain('250');
    expect(document.body.textContent).not.toContain('Menghitung');
    await click(document.getElementById('self')); await settle();
    expect(calls['/api/stall-own/settlements/preview']).toBe(2);
    previewOk = false;
    await click(document.getElementById('other')); await settle();
    expect(calls['/api/stall-own/settlements/preview']).toBe(3);
    expect(document.body.textContent).toContain('250');   // preview lama dipertahankan
  });

  it('Klasik (enabled=false): bump tidak memuat ulang preview', async () => {
    await act(async () => { root.render(ui(false)); });
    await openModal();
    await click(document.getElementById('other')); await settle();
    expect(calls['/api/stall-own/settlements/preview']).toBe(1);
  });
});
