// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData, useDataRevision } from '@/lib/data-sync';

vi.mock('@react-pdf/renderer', () => ({ pdf: () => ({ toBlob: async () => new Blob() }), Document: () => null, Page: () => null, View: () => null, Text: () => null, Image: () => null, StyleSheet: { create: (s: unknown) => s }, Font: { register: () => {} } }));
vi.mock('exceljs', () => ({ default: { Workbook: class {} } }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/components/Confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/components/TopbarPortal', () => ({ default: () => null }));
vi.mock('@/lib/pdf/useStoreHeader', () => ({ useStoreHeader: () => ({}) }));

import ConsignmentTab from './ConsignmentTab';
import MitraDailyReportTab from './MitraDailyReportTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let reportOk = true;
let reportName = 'Mitra A';
let deleteOk = true;
let approveOk = true;
let holdReportFirst = false;
let releaseReport: (() => void) | null = null;
const calls: Record<string, number> = {};
let host: HTMLDivElement; let root: Root;
const section = (name: string) => ({ locationId: 'l1', locationName: name, code: 'M1', contactName: '', contactPhone: '', isActive: true, days: [], totals: { kirim: 0, nilaiKirim: 0, jual: 0, nilaiJual: 0, retur: 0, reject: 0, selisih: 0, transferMasuk: 0, transferKeluar: 0 } });
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  reportOk = true; reportName = 'Mitra A'; deleteOk = true; approveOk = true; holdReportFirst = false; releaseReport = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const key = `${init?.method ?? 'GET'} ${path}`;
    calls[key] = (calls[key] ?? 0) + 1;
    const json = (b: unknown, ok = true) => ({ ok, json: async () => b });
    if (path === '/api/consignment/daily-report') {
      if (holdReportFirst) {   // muat biasa LAMBAT berisi data lama, dilepas manual
        holdReportFirst = false;
        return new Promise(res => { releaseReport = () => res({ ok: true, json: async () => ({ sections: [section('Mitra LAMA')] }) }); });
      }
      return json(reportOk ? { sections: [section(reportName)] } : { error: 'x' }, reportOk);
    }
    if (path === '/api/consignment/locations') return json({ locations: [{ id: 'l1', name: 'Mitra A', contactName: '', contactPhone: '', address: '', note: '' }] });
    if (path === '/api/consignment/locations/l1' && init?.method === 'DELETE') return json({}, deleteOk);
    if (path.endsWith('/stock')) return json({ stock: [] });
    if (path === '/api/consignment/send/s1/approve') return json({}, approveOk);
    if (path === '/api/consignment/send') return json({ shipments: [{ id: 's1', locationId: 'l1', locationName: 'Mitra A', warehouseId: 'w1', warehouseName: 'Gudang', items: [], status: 'draft', createdAt: { seconds: Math.floor(Date.now() / 1000) } }] });
    if (path === '/api/consignment/recap') return json({ recaps: [] });
    if (path === '/api/consignment/transfers') return json({ transfers: [] });
    if (path === '/api/warehouses') return json({ warehouses: [] });
    if (path === '/api/wallets') return json({ wallets: [] });
    if (path === '/api/settings') return json({ settings: {} });
    return json({});
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const seen: Record<string, number[]> = { consignment: [], products: [], wallets: [] };
function Probe() {
  const c = useDataRevision('consignment'); const p = useDataRevision('products'); const w = useDataRevision('wallets');
  useEffect(() => { seen.consignment.push(c); }, [c]);
  useEffect(() => { seen.products.push(p); }, [p]);
  useEffect(() => { seen.wallets.push(w); }, [w]);
  return null;
}
function Bumper() {
  const bump = useBumpData();
  return (<>
    <button id="mitra" onClick={() => bump('consignment', 'consignment-tab')}>mitra</button>
  </>);
}
const render = (ui: ReactNode) => act(async () => { root.render(ui); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

describe('MitraDailyReportTab: segar senyap saat Mitra menulis (domain consignment)', () => {
  const ui = (enabled: boolean) => (<DataSyncProvider enabled={enabled}><Bumper /><MitraDailyReportTab creds="x" /></DataSyncProvider>);
  const key = 'GET /api/consignment/daily-report';

  it('mode jendela: bump memuat ulang sekali, tanpa spinner, data baru tampil', async () => {
    await render(ui(true)); await settle();
    expect(calls[key]).toBe(1);
    expect(document.body.textContent).toContain('Mitra A');
    reportName = 'Mitra B';
    await click(document.getElementById('mitra')); await settle();
    expect(calls[key]).toBe(2);
    expect(document.body.textContent).toContain('Mitra B');
    await settle();
    expect(calls[key]).toBe(2);   // tidak ada loop
  });

  it('gagal (500): laporan lama dipertahankan, tidak ada pesan error', async () => {
    await render(ui(true)); await settle();
    reportOk = false;
    await click(document.getElementById('mitra')); await settle();
    expect(calls[key]).toBe(2);
    expect(document.body.textContent).toContain('Mitra A');
    expect(document.body.textContent).not.toContain('Gagal memuat laporan');
  });

  it('Klasik (enabled=false): bump tidak memuat ulang', async () => {
    await render(ui(false)); await settle();
    await click(document.getElementById('mitra')); await settle();
    expect(calls[key]).toBe(1);
  });

  it('muat biasa lambat yang selesai SETELAH hasil senyap yang lebih baru tidak menimpa data baru', async () => {
    holdReportFirst = true;
    await render(ui(true)); await settle();           // muat awal tertahan
    reportName = 'Mitra BARU';
    await click(document.getElementById('mitra')); await settle();   // senyap selesai lebih dulu
    expect(document.body.textContent).toContain('Mitra BARU');
    await act(async () => { releaseReport?.(); await new Promise(r => setTimeout(r, 50)); });
    expect(document.body.textContent).toContain('Mitra BARU');
    expect(document.body.textContent).not.toContain('Mitra LAMA');
  });
});

describe('ConsignmentTab -> bump domain Mitra', () => {
  const ui = (enabled: boolean) => (
    <DataSyncProvider enabled={enabled}><Probe /><ConsignmentTab creds="x" products={[]} can={() => true} /></DataSyncProvider>
  );
  const del = async () => {
    await settle();
    await click(document.querySelector('button[title="Hapus"]'));
    await settle();
  };
  beforeEach(() => { seen.consignment = []; seen.products = []; seen.wallets = []; });

  it('hapus lokasi berhasil: consignment naik sekali; products/wallets tidak', async () => {
    await render(ui(true)); await del();
    expect(calls['DELETE /api/consignment/locations/l1']).toBe(1);
    expect(seen.consignment).toEqual([0, 1]);
    expect(seen.products).toEqual([0]);
    expect(seen.wallets).toEqual([0]);
  });

  const approve = async () => {
    await settle();
    await click([...document.querySelectorAll('button')].find(b => b.textContent?.includes('Kirim Stok')) ?? null);
    await settle();
    await click(document.querySelector('button[aria-label="Approve"]'));
    await settle();
  };
  it('approve pengiriman berhasil: bump consignment dan products sekali; wallets tidak', async () => {
    await render(ui(true)); await approve();
    expect(calls['POST /api/consignment/send/s1/approve']).toBe(1);
    expect(seen.consignment).toEqual([0, 1]);
    expect(seen.products).toEqual([0, 1]);
    expect(seen.wallets).toEqual([0]);
  });

  it('approve pengiriman gagal: tidak ada bump', async () => {
    approveOk = false;
    await render(ui(true)); await approve();
    expect(calls['POST /api/consignment/send/s1/approve']).toBe(1);
    expect(seen.consignment).toEqual([0]);
    expect(seen.products).toEqual([0]);
  });

  it('hapus lokasi gagal: tidak ada bump', async () => {
    deleteOk = false;
    await render(ui(true)); await del();
    expect(calls['DELETE /api/consignment/locations/l1']).toBe(1);
    expect(seen.consignment).toEqual([0]);
  });

  it('Klasik: tidak ada bump', async () => {
    await render(ui(false)); await del();
    expect(calls['DELETE /api/consignment/locations/l1']).toBe(1);
    expect(seen.consignment).toEqual([0]);
  });
});
