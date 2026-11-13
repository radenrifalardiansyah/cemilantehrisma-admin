// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import ClosingSettlementDialog from './ClosingSettlementDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

async function open(closing: { totalCogs: number; settlementRemaining: number }, over: { walletsOk?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (over.walletsOk === false) return Promise.resolve(new Response('{}', { status: 403 }));
    if (url.includes('/api/wallets/balances')) return ok({ balances: { kas: 50_000_000 } });
    if (url.includes('/api/wallets')) return ok({ wallets: [{ id: 'kas', name: 'Kas', type: 'cash', icon: 'Wallet', color: '#000', initialBalance: 0, isActive: true }] });
    return ok({ transfers: [] });
  }));
  await act(async () => {
    root.render(
      <ToastProvider>
        <ClosingSettlementDialog creds="x" onClose={() => {}} onDone={() => {}}
          closing={{ id: 'c1', periodFrom: '2026-11-12', periodTo: '2026-11-13', ...closing }} />
      </ToastProvider>,
    );
  });
  await flush();
}
const digits = (s: string) => Number(s.replace(/\D/g, ''));
const amountInput = () => Array.from(document.querySelectorAll('input')).find(i => i.placeholder === '0') as HTMLInputElement;

describe('ClosingSettlementDialog: nominal bawaan', () => {
  it('nominal bawaan = sisa HPP bulat, tidak boleh melebihi sisa HPP berdesimal (server menolak > sisa + 0,005)', async () => {
    await open({ totalCogs: 12_345.67, settlementRemaining: 12_345.67 });
    expect(digits(amountInput().value)).toBeLessThanOrEqual(12_345.67 + 0.005);
  });
  it('sisa bulat: nominal bawaan sama dengan sisa', async () => {
    await open({ totalCogs: 118_750, settlementRemaining: 118_750 });
    expect(digits(amountInput().value)).toBe(118_750);
  });
  it('tanpa akses lihat Dompet: tampil pesan galat dan tombol simpan nonaktif', async () => {
    await open({ totalCogs: 1000, settlementRemaining: 1000 }, { walletsOk: false });
    expect(document.body.textContent).toMatch(/butuh akses lihat Dompet/);
    const submit = Array.from(document.querySelectorAll('button')).find(b => /Catat & Tautkan/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
