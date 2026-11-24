// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import ConfirmProvider from '@/components/Confirm';
import { DataSyncProvider, useBumpData, useDataRevision } from '@/lib/data-sync';
import { WindowVisibleContext } from '@/components/desktop/window-visible';

const scanner = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock('@/components/BarcodeScannerModal', async () => {
  const { useEffect: ue } = await import('react');
  return { default: function ScannerMock() { ue(() => { scanner.mounts++; return () => { scanner.unmounts++; }; }, []); return <div id="scanner">kamera</div>; } };
});

import KasirLapakTab from './KasirLapakTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stall = { id: 's1', code: 'L1', name: 'Lapak Satu', address: '', warehouseId: 'w1', invoicePrefix: 'L1', walletBalance: 0,
  shift: { id: 'sh1', stallId: 's1', openedBy: 'u', openingBalance: 0, openedAt: null, status: 'open' } };
let items = [{ kind: 'own', productId: 'p1', name: 'Keripik Pedas', code: 'KP', unit: 'pcs', price: 10000, stock: 5 }];
const calls: Record<string, number> = {};
let salesOk = true;
let host: HTMLDivElement; let root: Root;

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  salesOk = true; scanner.mounts = 0; scanner.unmounts = 0;
  items = [{ kind: 'own', productId: 'p1', name: 'Keripik Pedas', code: 'KP', unit: 'pcs', price: 10000, stock: 5 }];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/?]+/, '').split('?')[0];
    const key = `${init?.method ?? 'GET'} ${path}`;
    calls[key] = (calls[key] ?? 0) + 1;
    if (key === 'POST /api/stall-pos/sales') {
      return salesOk
        ? { ok: true, json: async () => ({ sale: { id: 'x', invoiceNo: 'INV1', items: [], total: 10000, subtotal: 10000, discount: 0, paymentMethod: 'qris', amountPaid: 10000, changeAmount: 0, createdAt: null } }) }
        : { ok: false, json: async () => ({ error: 'stok kurang' }) };
    }
    const body = path === '/api/stall-pos/stalls' ? { stalls: [stall] } : path === '/api/stall-pos/catalog' ? { items, hasWarehouse: true }
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
const ui = (opts: { enabled?: boolean; visible?: boolean } = {}): ReactNode => (
  <ToastProvider><ConfirmProvider>
    <DataSyncProvider enabled={opts.enabled ?? true}>
      <WindowVisibleContext.Provider value={opts.visible ?? true}>
        <Reader /><Other /><KasirLapakTab creds="x" can={() => true} />
      </WindowVisibleContext.Provider>
    </DataSyncProvider>
  </ConfirmProvider></ToastProvider>
);
const render = (n: ReactNode) => act(async () => { root.render(n); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const clickEl = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

describe('KasirLapakTab di jendela', () => {
  beforeEach(() => { revSeen.length = 0; });

  it('kamera scanner berhenti saat jendela dikecilkan dan TIDAK menyala lagi otomatis saat dipulihkan (tanpa prompt izin mengejutkan)', async () => {
    await render(ui({ visible: true })); await settle();
    await clickEl(document.querySelector('[aria-label="Scan barcode / QR produk"]'));
    expect(document.getElementById('scanner')).not.toBeNull();
    expect(scanner.mounts).toBe(1);
    await render(ui({ visible: false })); await settle();            // dikecilkan
    expect(document.getElementById('scanner')).toBeNull();
    expect(scanner.unmounts).toBe(1);                                 // stream dihentikan (cleanup dijalankan)
    await render(ui({ visible: true })); await settle();             // dipulihkan
    expect(document.getElementById('scanner')).toBeNull();            // tetap tertutup; pengguna membukanya lagi bila perlu
    expect(scanner.mounts).toBe(1);
  });

  it('penjualan berhasil mem-bump consign sekali; penjualan gagal tidak mem-bump', async () => {
    await render(ui()); await settle();
    const pay = async () => {
      await clickEl(Array.from(document.querySelectorAll('.card')).find(c => c.textContent?.includes('Keripik Pedas')) ?? null);
      await clickEl(Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('QRIS')) ?? null);
      await clickEl(Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Proses Transaksi')) ?? null);
      await settle();
    };
    salesOk = false;
    await pay();
    expect(calls['POST /api/stall-pos/sales']).toBe(1);
    expect(revSeen).toEqual([0]);                                     // gagal: tanpa bump
    salesOk = true;
    await pay();
    expect(calls['POST /api/stall-pos/sales']).toBe(2);
    expect(revSeen).toEqual([0, 1]);                                  // sukses: satu bump
  });

  it('bump consign dari jendela lain memuat ulang katalog senyap tanpa mengosongkan keranjang; Klasik tidak memuat ulang', async () => {
    await render(ui()); await settle();
    await clickEl(Array.from(document.querySelectorAll('.card')).find(c => c.textContent?.includes('Keripik Pedas')) ?? null);
    const before = calls['GET /api/stall-pos/catalog'];
    items = [{ ...items[0], stock: 3 }];
    await clickEl(document.getElementById('other')); await settle();
    expect(calls['GET /api/stall-pos/catalog']).toBe(before + 1);
    expect(document.body.textContent).toContain('Keripik Pedas');
    expect(document.body.textContent).toContain('Proses Transaksi');   // keranjang tetap terisi (checkout masih tampil)
  });

  it('Klasik (enabled=false): bump tidak memicu muat ulang katalog', async () => {
    await render(ui({ enabled: false })); await settle();
    const before = calls['GET /api/stall-pos/catalog'];
    await clickEl(document.getElementById('other')); await settle();
    expect(calls['GET /api/stall-pos/catalog']).toBe(before);
  });

  it('keranjang disinkronkan setelah muat ulang: item yang jadi diblokir (stok > 0) dibuang dengan toast; tanpa perubahan keranjang tidak disentuh', async () => {
    await render(ui()); await settle();
    await clickEl(Array.from(document.querySelectorAll('.card')).find(c => c.textContent?.includes('Keripik Pedas')) ?? null);
    await clickEl(document.getElementById('other')); await settle();                    // katalog sama: tidak ada toast
    expect(document.body.textContent).not.toContain('Stok berubah, keranjang disesuaikan.');
    items = [{ ...items[0], stock: 5, blocked: 'Harga belum diatur' } as typeof items[number]];
    await clickEl(document.getElementById('other')); await settle();
    expect(document.body.textContent).toContain('Stok berubah, keranjang disesuaikan.');
  });
});
