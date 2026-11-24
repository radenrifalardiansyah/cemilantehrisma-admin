// @vitest-environment jsdom
// Tes review Layout Desktop tahap 20+21: celah sinkron antar jendela yang tidak tercakup tes bawaan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData } from '@/lib/data-sync';

vi.mock('./stall-own/ShipmentsSection', () => ({
  default: (p: { stalls: { id: string }[] }) => <span id="shipments">{p.stalls.map(s => s.id).join(',')}</span>,
}));
vi.mock('./stall-own/PricesSection', () => ({ default: () => <span id="prices" /> }));
vi.mock('./stall-own/SettlementsSection', () => ({ default: () => <span id="settlements" /> }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/lib/pdf/useStoreHeader', () => ({ useStoreHeader: () => ({}) }));
vi.mock('@/components/Confirm', () => ({ useConfirm: () => async () => true }));

import StallOwnTab from './StallOwnTab';
import CashierSalesReportTab from './CashierSalesReportTab';
import TitipJualTab from './TitipJualTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: Record<string, number> = {};
let failing = false;
let host: HTMLDivElement; let root: Root;
const stall = { id: 's1', name: 'Lapak A', code: 'A', isActive: true, balance: 1000 };
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  failing = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    calls[path] = (calls[path] ?? 0) + 1;
    // Muat awal (panggilan pertama tiap path) selalu sukses; saat `failing`, panggilan berikutnya gagal 500 (gangguan sesaat).
    if (failing && calls[path] > 1) return { ok: false, json: async () => ({}) };
    const body = path === '/api/stalls' ? { stalls: [stall] } : path === '/api/warehouses' ? { warehouses: [] }
      : path === '/api/stall-pos/cashier-report' ? { stalls: [], names: {}, summary: { count: 7, revenue: 70000, discount: 0 }, cashiers: [], shifts: [] }
      : path === '/api/consign/wallet-journal' ? { entries: [], summary: { openingBalance: 0, inflow: 0, outflow: 0, currentBalance: 1000 } }
      : path === '/api/consign/settlements' ? { settlements: [], payables: [] }
      : {};
    return { ok: true, json: async () => body };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function Bumper() {
  const bump = useBumpData();
  return <button id="other" onClick={() => bump('consign', 'titip-jual-tab:main')}>lain</button>;
}
const render = (ui: ReactNode) => act(async () => { root.render(ui); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 250)); });
const click = (id: string) => act(async () => { document.getElementById(id)!.click(); });

describe('Dompet Lapak (journal) membuka satu lapak: sinkron lintas jendela', () => {
  it('bump consign dari jendela lain (mis. Setoran Lapak membayar) memuat ulang juga entri/ringkasan jurnal, bukan hanya saldo di header', async () => {
    await render(
      <DataSyncProvider enabled>
        <Bumper />
        <TitipJualTab creds="x" mode="journal" can={() => true} journalStallId="s1" journalSeq={1} />
      </DataSyncProvider>,
    );
    await settle();
    expect(calls['/api/stalls']).toBe(1);
    expect(calls['/api/consign/wallet-journal']).toBe(1);
    await click('other'); await settle();
    expect(calls['/api/stalls']).toBe(2);                            // saldo header menyegar
    expect(calls['/api/consign/wallet-journal']).toBe(2);            // jurnal (baris + ringkasan) harus ikut menyegar
  });
});

describe('muat ulang senyap karena bump consign tidak boleh merusak tampilan yang sudah benar bila server gagal sesaat', () => {
  it('CashierSalesReportTab: refresh gagal (500) mempertahankan laporan lama, tidak berubah menjadi spinner permanen', async () => {
    await render(<DataSyncProvider enabled><Bumper /><CashierSalesReportTab creds="x" /></DataSyncProvider>);
    await settle();
    expect(document.body.textContent).not.toContain('Memuat');
    failing = true;
    await click('other'); await settle();
    expect(calls['/api/stall-pos/cashier-report']).toBe(2);
    expect(document.querySelector('[role="status"], .animate-spin')).toBeNull();   // tidak kembali ke PageLoader
  });

  it('StallOwnTab: refresh gagal (500) mempertahankan daftar lapak lama, tidak mengosongkannya', async () => {
    await render(<DataSyncProvider enabled><Bumper /><StallOwnTab creds="x" can={() => true} /></DataSyncProvider>);
    await settle();
    expect(document.getElementById('shipments')!.textContent).toBe('s1');
    failing = true;
    await click('other'); await settle();
    expect(calls['/api/stalls']).toBe(2);
    expect(document.getElementById('shipments')!.textContent).toBe('s1');
  });
});
