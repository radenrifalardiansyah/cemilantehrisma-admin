// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData } from '@/lib/data-sync';

vi.mock('./DataList', () => ({ default: () => null, DetailPanel: () => null }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/components/Confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/lib/pdf/useStoreHeader', () => ({ useStoreHeader: () => ({}) }));

import SettlementsSection from './SettlementsSection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let holdNext = false;
let releaseHeld: (() => void) | null = null;
let previewOk = true;
const calls = { preview: 0 };
let host: HTMLDivElement; let root: Root;
const prev = (total: number) => ({ items: [{ productId: 'p1', productName: 'Keripik', qty: 1, amount: total }], total, count: 1 });
beforeEach(() => {
  holdNext = false; releaseHeld = null; previewOk = true; calls.preview = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (path === '/api/consign/settlements') return { ok: true, json: async () => ({ settlements: [], payables: [{ stallId: 's1', consignorId: 'c1', consignorName: 'Penitip 1', amount: 100, lines: 1, firstDate: '2026-11-01', lastDate: '2026-11-01' }] }) };
    if (path === '/api/consign/settlements/preview') {
      calls.preview++;
      if (holdNext) {
        holdNext = false;
        return new Promise(res => { releaseHeld = () => res({ ok: true, json: async () => prev(111111) }); });
      }
      return { ok: previewOk, json: async () => prev(222222) };
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
    <button id="self" onClick={() => bump('consign', 'titip-jual-tab:main')}>sendiri</button>
  </>);
}
const data = { stalls: [{ id: 's1', name: 'Lapak 1', code: 'L1' }], consignors: [{ id: 'c1', name: 'Penitip 1', code: 'P1' }] } as never;
const ui = (enabled: boolean): ReactNode => (
  <DataSyncProvider enabled={enabled}><Bumper /><SettlementsSection creds="x" data={data} reload={async () => {}} can={() => true} /></DataSyncProvider>
);
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 250)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const open = async () => {
  await settle();
  await click([...document.querySelectorAll('button')].find(b => b.textContent === 'Buat Rekap') ?? null);
  await settle();
};

describe('Rekap Bagi Hasil: preview menyegar senyap', () => {
  it('bump jendela lain memuat ulang sekali; bump sendiri tidak; gagal mempertahankan preview lama', async () => {
    await act(async () => { root.render(ui(true)); });
    await open();
    expect(calls.preview).toBe(1);
    await click(document.getElementById('other')); await settle();
    expect(calls.preview).toBe(2);
    await click(document.getElementById('self')); await settle();
    expect(calls.preview).toBe(2);
    previewOk = false;
    await click(document.getElementById('other')); await settle();
    expect(calls.preview).toBe(3);
    expect(document.body.textContent).toContain('222.222');
    expect(document.body.textContent).not.toContain('Menghitung');
  });

  it('respons segar-ulang lambat untuk rentang lama tidak menimpa preview rentang baru', async () => {
    await act(async () => { root.render(ui(true)); });
    await open();
    expect(document.body.textContent).toContain('222.222');
    holdNext = true;
    await click(document.getElementById('other')); await settle();
    await click(document.querySelector('input[type="checkbox"]')); await settle();
    await act(async () => { releaseHeld?.(); await new Promise(r => setTimeout(r, 50)); });
    expect(document.body.textContent).toContain('222.222');
    expect(document.body.textContent).not.toContain('111.111');
  });

  it('Klasik (enabled=false): bump tidak memuat ulang', async () => {
    await act(async () => { root.render(ui(false)); });
    await open();
    await click(document.getElementById('other')); await settle();
    expect(calls.preview).toBe(1);
  });
});
