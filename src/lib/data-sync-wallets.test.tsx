// @vitest-environment jsdom
// Memakai hook NYATA useWallets/useWalletBalances (bukan tiruan) dengan fetch di-mock, untuk membuktikan perilaku
// sinkron data pada pembaca dompet: nol fetch tambahan di Klasik, dan jumlah fetch per bump di mode jendela.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData } from './data-sync';
import { useWallets, useWalletBalances } from './useWallets';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WALLETS = [{ id: 'w1', name: 'Kas', type: 'cash', isActive: true }];
const calls = { wallets: 0, balances: 0 };

function Reader() {
  const wallets = useWallets('x');
  const [balances] = useWalletBalances('x', wallets);
  return <span id="out">{wallets.length}:{balances.w1 ?? '-'}</span>;
}
function Writer() {
  const bump = useBumpData();
  return <button id="w" onClick={() => bump('wallets', 'expenses-tab')}>b</button>;
}

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  calls.wallets = 0; calls.balances = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/wallets') { calls.wallets++; return { ok: true, json: async () => ({ wallets: [...WALLETS] }) }; }
    if (url === '/api/wallets/balances') { calls.balances++; return { ok: true, json: async () => ({ balances: { w1: 100 } }) }; }
    throw new Error(`fetch tak terduga: ${url}`);
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = (ui: ReactNode) => act(async () => { root.render(ui); });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });

describe('data-sync pada useWallets/useWalletBalances (hook nyata)', () => {
  it('mount: tepat satu fetch dompet dan satu fetch saldo (revisi awal dilewati, sama dengan Klasik)', async () => {
    await render(<DataSyncProvider enabled><Reader /></DataSyncProvider>);
    await settle();
    expect(calls).toEqual({ wallets: 1, balances: 1 });
  });

  it('Klasik (enabled=false): bump tidak memicu fetch tambahan sama sekali', async () => {
    await render(<DataSyncProvider enabled={false}><Writer /><Reader /></DataSyncProvider>);
    await settle();
    await act(async () => { document.getElementById('w')!.click(); });
    await settle();
    expect(calls).toEqual({ wallets: 1, balances: 1 });
  });

  it('tanpa provider: tidak ada fetch tambahan', async () => {
    await render(<><Writer /><Reader /></>);
    await settle();
    await act(async () => { document.getElementById('w')!.click(); });
    await settle();
    expect(calls).toEqual({ wallets: 1, balances: 1 });
  });

  it('mode jendela: satu bump menghasilkan SATU muat ulang daftar dompet dan SATU muat ulang saldo', async () => {
    await render(<DataSyncProvider enabled><Writer /><Reader /></DataSyncProvider>);
    await settle();
    await act(async () => { document.getElementById('w')!.click(); });
    await settle();
    expect(calls.wallets).toBe(2);   // 1 mount + 1 bump
    expect(calls.balances).toBe(2);  // 1 mount + 1 bump (bukan 3)
  });
});
