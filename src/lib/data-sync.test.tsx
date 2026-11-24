// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData, useDataRevision, useOnDataRevision, type DataDomain } from './data-sync';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loads = { products: 0, categories: 0, self: 0 };
function Writer({ domain, source, id = 'w' }: { domain: DataDomain; source?: string; id?: string }) {
  const bump = useBumpData();
  return <button id={id} onClick={() => bump(domain, source)}>bump</button>;
}
function Reader({ domain, name, selfId }: { domain: DataDomain; name: keyof typeof loads; selfId?: string }) {
  const rev = useDataRevision(domain);
  useOnDataRevision(domain, () => { loads[name]++; }, selfId);
  return <span id={`rev-${name}`}>{rev}</span>;
}
function Toggle({ children }: { children: (enabled: boolean) => ReactNode }) {
  const [on, setOn] = useState(true);
  return <><button id="toggle" onClick={() => setOn(o => !o)}>t</button>{children(on)}</>;
}

let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.useFakeTimers(); loads.products = loads.categories = loads.self = 0; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.useRealTimers(); });
const render = (ui: ReactNode) => act(() => root.render(ui));
const click = (id: string) => act(() => { document.getElementById(id)!.click(); });
const flush = () => act(() => { vi.advanceTimersByTime(200); });

describe('data-sync', () => {
  it('Klasik (enabled=false): bump no-op, revisi tetap 0, pembaca tidak memuat ulang', () => {
    render(<DataSyncProvider enabled={false}><Writer domain="categories" /><Reader domain="categories" name="categories" /></DataSyncProvider>);
    click('w'); flush();
    expect(document.getElementById('rev-categories')!.textContent).toBe('0');
    expect(loads.categories).toBe(0);
  });

  it('tanpa provider: aman (bump no-op, revisi 0)', () => {
    render(<><Writer domain="products" /><Reader domain="products" name="products" /></>);
    click('w'); flush();
    expect(loads.products).toBe(0);
    expect(document.getElementById('rev-products')!.textContent).toBe('0');
  });

  it('mode jendela: Kategori -> Produk memuat ulang SEKALI setelah bump; domain lain tidak terpengaruh; mount tidak memicu load', () => {
    render(<DataSyncProvider enabled><Writer domain="categories" /><Reader domain="categories" name="categories" /><Reader domain="products" name="products" /></DataSyncProvider>);
    expect(loads).toEqual({ products: 0, categories: 0, self: 0 });
    click('w'); flush();
    expect(loads.categories).toBe(1);
    expect(loads.products).toBe(0);
    flush();
    expect(loads.categories).toBe(1);
  });

  it('bump beruntun digabung menjadi satu muat ulang', () => {
    render(<DataSyncProvider enabled><Writer domain="categories" /><Reader domain="categories" name="categories" /></DataSyncProvider>);
    click('w'); click('w'); click('w'); flush();
    expect(loads.categories).toBe(1);
  });

  it('penulis tidak memuat ulang dirinya sendiri (selfId), tab lain tetap', () => {
    render(<DataSyncProvider enabled><Writer domain="products" source="orders-tab" /><Reader domain="products" name="self" selfId="orders-tab" /><Reader domain="products" name="products" selfId="products-tab" /></DataSyncProvider>);
    click('w'); flush();
    expect(loads.self).toBe(0);
    expect(loads.products).toBe(1);
  });

  it('dua sumber berbeda dalam satu jendela waktu: semua pembaca menyegar (tidak ada yang dilewati)', () => {
    render(<DataSyncProvider enabled><Writer domain="products" source="a" id="wa" /><Writer domain="products" source="b" id="wb" /><Reader domain="products" name="self" selfId="a" /></DataSyncProvider>);
    click('wa'); click('wb'); flush();
    expect(loads.self).toBe(1);
  });

  it('tab yang di-mount SESUDAH revisi naik memakainya sebagai dasar: tidak ada muat ulang ekstra', () => {
    function Late() { const [show, setShow] = useState(false); return <>{show && <Reader domain="categories" name="categories" />}<button id="show" onClick={() => setShow(true)}>s</button></>; }
    render(<DataSyncProvider enabled><Writer domain="categories" /><Late /></DataSyncProvider>);
    click('w'); flush();
    click('show');
    expect(loads.categories).toBe(0);
  });

  it('mematikan enabled (kembali Klasik) tidak memicu muat ulang dan bump jadi no-op; menyalakan lagi aktif', () => {
    render(<DataSyncProvider enabled><Toggle>{on => <DataSyncProvider enabled={on}><Writer domain="categories" /><Reader domain="categories" name="categories" /></DataSyncProvider>}</Toggle></DataSyncProvider>);
    click('w'); flush();
    expect(loads.categories).toBe(1);
    click('toggle');
    click('w'); flush();
    expect(loads.categories).toBe(1);
  });

  it("domain 'roles' (Role -> dropdown role di Pengguna): satu bump memuat ulang pembaca sekali; Klasik no-op", () => {
    render(<DataSyncProvider enabled><Writer domain="roles" source="roles-tab" /><Reader domain="roles" name="categories" /></DataSyncProvider>);
    click('w'); flush();
    expect(loads.categories).toBe(1);
    act(() => root.unmount()); root = createRoot(host);
    render(<DataSyncProvider enabled={false}><Writer domain="roles" source="roles-tab" /><Reader domain="roles" name="categories" /></DataSyncProvider>);
    click('w'); flush();
    expect(loads.categories).toBe(1);
  });
});
