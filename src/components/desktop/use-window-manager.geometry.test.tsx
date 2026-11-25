// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useWindowManager } from './use-window-manager';
import { geometryKey } from '@/lib/window-geometry';
import type { DesktopSkin, WmAction } from './window-reducer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let send: (a: WmAction) => void = () => {};
const rects = () => JSON.parse(document.getElementById('o')!.dataset.rects || '[]') as { tabId: string; x: number; y: number; w: number; h: number; maximized: boolean }[];
function H({ enabled = true, skin = 'windows', username, tab = 'dashboard' }: { enabled?: boolean; skin?: DesktopSkin; username?: string; tab?: string }) {
  const { wm, dispatch } = useWindowManager({ enabled, skin, activeTab: tab, username });
  useEffect(() => { send = dispatch; });
  return <i id="o" data-rects={JSON.stringify(wm.windows.map(w => ({ tabId: w.tabId, x: w.x, y: w.y, w: w.w, h: w.h, maximized: w.maximized })))} />;
}
let host: HTMLDivElement; let root: Root;
const setViewport = (w: number, h: number) => { Object.defineProperty(window, 'innerWidth', { value: w, configurable: true }); Object.defineProperty(window, 'innerHeight', { value: h, configurable: true }); };
beforeEach(() => { localStorage.clear(); setViewport(1600, 900); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); });
const render = (ui: ReactNode) => act(() => root.render(ui));
const dispatch = (a: WmAction) => act(() => send(a));
const stored = (u: string, skin: string) => JSON.parse(localStorage.getItem(geometryKey(u, skin)) || 'null') as Record<string, { x: number; y: number; w: number; h: number }> | null;
const SAVED = { x: 123, y: 77, w: 700, h: 450 };
const seed = (u: string, skin: string, map: unknown) => localStorage.setItem(geometryKey(u, skin), JSON.stringify(map));

describe('useWindowManager: geometri tersimpan', () => {
  it('desktop awal tetap kosong meski ada geometri tersimpan', () => {
    seed('rifal', 'windows', { orders: SAVED });
    render(<StrictMode><H username="rifal" tab="orders" /></StrictMode>);
    expect(rects()).toEqual([]);
  });

  it('jendela dibuka memakai geometri tersimpan', async () => {
    seed('rifal', 'windows', { orders: SAVED });
    await render(<H username="rifal" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    expect(rects()[0]).toMatchObject(SAVED);
  });

  it('tanpa geometri tersimpan memakai cascade/default; cascade jendela berikutnya tetap bekerja', async () => {
    await render(<H username="rifal" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    await dispatch({ type: 'open', tabId: 'products' });
    const [a, b] = rects();
    expect(a.x).toBe(96);
    expect(b.x).toBe(96 + 34);
  });

  it('layar lebih kecil dari geometri tersimpan: dijepit ulang ke area saat ini', async () => {
    setViewport(900, 600);
    seed('rifal', 'windows', { orders: { x: 1200, y: 800, w: 1400, h: 900 } });
    await render(<H username="rifal" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    const r = rects()[0];
    expect(r.x + r.w).toBeLessThanOrEqual(900);
    expect(r.y + r.h).toBeLessThanOrEqual(600 - 48);
    expect(r.x).toBeGreaterThanOrEqual(0);
  });

  it('data rusak di penyimpanan diabaikan (default dipakai)', async () => {
    localStorage.setItem(geometryKey('rifal', 'windows'), '{rusak');
    await render(<H username="rifal" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    expect(rects()[0].x).toBe(96);
  });

  it('terpisah per skin dan per pengguna', async () => {
    seed('rifal', 'mac', { orders: SAVED });
    await render(<H username="rifal" skin="windows" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    expect(rects()[0].x).toBe(96);   // skin windows tidak punya geometri
    act(() => root.unmount()); root = createRoot(host);
    await render(<H username="lain" skin="mac" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    expect(rects()[0].x).toBe(96);   // pengguna lain tidak punya
  });

  it('tanpa username: tidak membaca dan tidak menyimpan', async () => {
    seed('', 'windows', { orders: SAVED });
    await render(<H />);
    await dispatch({ type: 'open', tabId: 'orders' });
    expect(rects()[0].x).toBe(96);
    await dispatch({ type: 'move', tabId: 'orders', x: 300, y: 100 });
    await dispatch({ type: 'settle', tabId: 'orders' });
    await dispatch({ type: 'close', tabId: 'orders' });
    expect(localStorage.length).toBe(1);   // hanya seed
  });

  it('Klasik (enabled=false) tidak menyimpan apa pun', async () => {
    await render(<H username="rifal" enabled={false} />);
    await dispatch({ type: 'open', tabId: 'orders' });
    await dispatch({ type: 'close', tabId: 'orders' });
    expect(stored('rifal', 'windows')).toBeNull();
  });
});

describe('useWindowManager: kapan geometri disimpan', () => {
  it('saat geser selesai (settle), bukan tiap frame', async () => {
    await render(<H username="rifal" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    await dispatch({ type: 'move', tabId: 'orders', x: 200, y: 120 });
    await dispatch({ type: 'move', tabId: 'orders', x: 260, y: 140 });
    expect(stored('rifal', 'windows')).toBeNull();
    await dispatch({ type: 'settle', tabId: 'orders' });
    expect(stored('rifal', 'windows')?.orders).toMatchObject({ x: 260, y: 140 });
  });

  it('saat ubah ukuran selesai', async () => {
    await render(<H username="rifal" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    await dispatch({ type: 'resize', tabId: 'orders', x: 100, y: 60, w: 800, h: 520 });
    await dispatch({ type: 'settle', tabId: 'orders' });
    expect(stored('rifal', 'windows')?.orders).toEqual({ x: 100, y: 60, w: 800, h: 520 });
  });

  it('saat ditutup dan saat dimaksimalkan (rect pemulihan), dan dipakai saat dibuka lagi', async () => {
    await render(<H username="rifal" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    await dispatch({ type: 'move', tabId: 'orders', x: 222, y: 99 });
    await dispatch({ type: 'maximize', tabId: 'orders' });
    expect(stored('rifal', 'windows')?.orders).toMatchObject({ x: 222, y: 99 });
    await dispatch({ type: 'maximize', tabId: 'orders' });
    await dispatch({ type: 'move', tabId: 'orders', x: 300, y: 150 });
    await dispatch({ type: 'close', tabId: 'orders' });
    expect(stored('rifal', 'windows')?.orders).toMatchObject({ x: 300, y: 150 });
    await dispatch({ type: 'open', tabId: 'orders' });
    expect(rects()[0]).toMatchObject({ x: 300, y: 150 });
  });

  it('snap menyimpan rect pra-tempel (bukan setengah layar)', async () => {
    await render(<H username="rifal" />);
    await dispatch({ type: 'open', tabId: 'orders' });
    await dispatch({ type: 'move', tabId: 'orders', x: 250, y: 130 });
    await dispatch({ type: 'snap', tabId: 'orders', side: 'left' });
    const saved = stored('rifal', 'windows')!.orders;
    expect(saved).toMatchObject({ x: 250, y: 130 });
    expect(saved.w).not.toBe(800);
    await dispatch({ type: 'close', tabId: 'orders' });
    expect(stored('rifal', 'windows')!.orders).toMatchObject({ x: 250, y: 130 });   // menutup saat tertempel tetap menyimpan rect pra-tempel
  });
});
