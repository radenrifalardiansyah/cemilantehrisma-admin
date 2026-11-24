// @vitest-environment jsdom
// Tes tinjauan tahap 22 (Aisha): celah di sinkronisasi KasirLapakTab berjendela. Tes yang gagal = bug nyata, jangan di-skip.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import ConfirmProvider from '@/components/Confirm';
import { DataSyncProvider, useBumpData, useDataRevision } from '@/lib/data-sync';

import KasirLapakTab from './KasirLapakTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stall = { id: 's1', code: 'L1', name: 'Lapak Satu', address: '', warehouseId: 'w1', invoicePrefix: 'L1', walletBalance: 0,
  shift: { id: 'sh1', stallId: 's1', openedBy: 'u', openingBalance: 0, openedAt: null, status: 'open' } };
const item = (stock: number) => [{ kind: 'own', productId: 'p1', name: 'Keripik Pedas', code: 'KP', unit: 'pcs', price: 10000, stock }];
let stock = 5;
let catalogMode: 'normal' | 'defer-next' | 'fail' = 'normal';
let deferred: { resolve: () => void } | null = null;
let host: HTMLDivElement; let root: Root;

beforeEach(() => {
  stock = 5; catalogMode = 'normal'; deferred = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/?]+/, '').split('?')[0];
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (key === 'POST /api/stall-pos/sales') {
      stock -= 1;
      return { ok: true, json: async () => ({ sale: { id: 'x', invoiceNo: 'INV1', items: [], total: 10000, subtotal: 10000, discount: 0, paymentMethod: 'qris', amountPaid: 10000, changeAmount: 0, createdAt: null } }) };
    }
    if (path === '/api/stall-pos/catalog') {
      if (catalogMode === 'fail') throw new TypeError('network');
      const snapshot = stock;                                  // data yang dilihat server SAAT permintaan ini diterima
      if (catalogMode === 'defer-next') {
        catalogMode = 'normal';
        return new Promise(res => { deferred = { resolve: () => res({ ok: true, json: async () => ({ items: item(snapshot), hasWarehouse: true }) }) }; });
      }
      return { ok: true, json: async () => ({ items: item(snapshot), hasWarehouse: true }) };
    }
    const body = path === '/api/stall-pos/stalls' ? { stalls: [stall] }
      : path === '/api/stall-pos/store' ? { store: { name: 'T', address: '', logo: '', whatsapp: '' } } : {};
    return { ok: true, json: async () => body };
  }));
  localStorage.clear();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const revSeen: number[] = [];
function Reader() { const r = useDataRevision('consign'); useEffect(() => { revSeen.push(r); }, [r]); return null; }
function Other() { const bump = useBumpData(); return <button id="other" onClick={() => bump('consign', 'stall-own-tab')}>o</button>; }
const ui = (): ReactNode => (
  <ToastProvider><ConfirmProvider>
    <DataSyncProvider enabled>
      <Reader /><Other /><KasirLapakTab creds="x" can={() => true} />
    </DataSyncProvider>
  </ConfirmProvider></ToastProvider>
);
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const clickEl = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const byText = (sel: string, t: string) => Array.from(document.querySelectorAll(sel)).find(c => c.textContent?.includes(t)) ?? null;

describe('KasirLapakTab di jendela: celah sinkronisasi', () => {
  beforeEach(() => { revSeen.length = 0; });

  it('respons muat-ulang senyap yang LAMBAT tidak menimpa katalog yang lebih baru (stok setelah penjualan)', async () => {
    await act(async () => { root.render(ui()); }); await settle();
    expect(document.body.textContent).toContain('Stok · 5');
    catalogMode = 'defer-next';                                         // muat ulang senyap pertama tertahan, melihat stok 5
    await clickEl(document.getElementById('other')); await settle();
    expect(deferred).not.toBeNull();
    await clickEl(byText('.card', 'Keripik Pedas'));                    // jual 1: server stok 4, reloadAll menampilkan 4
    await clickEl(byText('button', 'QRIS'));
    await clickEl(byText('button', 'Proses Transaksi')); await settle();
    expect(document.body.textContent).toContain('Stok · 4');
    await act(async () => { deferred!.resolve(); await new Promise(r => setTimeout(r, 50)); });   // respons basi tiba terakhir
    expect(document.body.textContent).toContain('Stok · 4');            // seharusnya tetap 4, bukan kembali 5
  });

  it('penjualan berhasil tetap mem-bump consign walau muat ulang katalog sesudahnya gagal jaringan', async () => {
    await act(async () => { root.render(ui()); }); await settle();
    await clickEl(byText('.card', 'Keripik Pedas'));
    await clickEl(byText('button', 'QRIS'));
    catalogMode = 'fail';                                               // POST sukses (stok sudah berkurang di server), muat ulang gagal
    await clickEl(byText('button', 'Proses Transaksi')); await settle();
    expect(stock).toBe(4);
    expect(revSeen).toEqual([0, 1]);                                    // jendela lain (laporan, Titip Jual) harus tetap diberi tahu
  });
});
