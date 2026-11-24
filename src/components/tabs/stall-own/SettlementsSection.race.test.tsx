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

let holdNext = false;
let releaseHeld: (() => void) | null = null;
let host: HTMLDivElement; let root: Root;
const prev = (total: number) => ({ items: [{ productId: 'p1', productName: 'Teh', qty: 1, amount: total }], total, count: 1 });
beforeEach(() => {
  holdNext = false; releaseHeld = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (path === '/api/stall-own/settlements') return { ok: true, json: async () => ({ settlements: [], payables: [{ stallId: 's1', amount: 100, lines: 1, firstDate: '2026-11-01', lastDate: '2026-11-01' }] }) };
    if (path === '/api/stall-own/settlements/preview') {
      if (holdNext) {   // respons LAMBAT untuk rentang lama (111111), dilepas manual
        holdNext = false;
        return new Promise(res => { releaseHeld = () => res({ ok: true, json: async () => prev(111111) }); });
      }
      return { ok: true, json: async () => prev(222222) };
    }
    return { ok: true, json: async () => ({}) };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function Bumper() { const bump = useBumpData(); return <button id="other" onClick={() => bump('consign', 'kasir-lapak')}>lain</button>; }
const stalls = [{ id: 's1', name: 'Lapak 1', code: 'L1', isActive: true }] as never;
const ui = (): ReactNode => (<DataSyncProvider enabled><Bumper /><SettlementsSection creds="x" stalls={stalls} warehouses={[]} can={() => true} /></DataSyncProvider>);
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 250)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

describe('Setoran Lapak: muat ulang senyap vs perubahan filter', () => {
  it('respons segar-ulang lambat untuk rentang lama tidak menimpa preview rentang baru setelah filter diganti', async () => {
    await act(async () => { root.render(ui()); });
    await settle();
    await click([...document.querySelectorAll('button')].find(b => b.textContent === 'Buat Setoran') ?? null);
    await settle();
    expect(document.body.textContent).toContain('222.222');
    holdNext = true;
    await click(document.getElementById('other')); await settle();                     // bump jendela lain: segar-ulang tertahan
    await click(document.querySelector('input[type="checkbox"]')); await settle();     // ganti rentang -> muat preview baru (222222)
    expect(document.body.textContent).toContain('222.222');
    await act(async () => { releaseHeld?.(); await new Promise(r => setTimeout(r, 50)); });   // respons lama tiba terlambat
    expect(document.body.textContent).toContain('222.222');
    expect(document.body.textContent).not.toContain('111.111');
  });
});
