// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { useWindowManager } from './use-window-manager';
import DesktopBoot from './DesktopBoot';
import { useBootSkin } from '@/lib/use-boot-skin';
import type { DesktopSkin } from './window-reducer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Hasil dibaca dari DOM (bukan variabel luar) supaya patuh aturan purity React.
const read = () => { const ids = (document.getElementById('o')!.dataset.ids || '').split(',').filter(Boolean); return { count: ids.length, ids }; };
function H({ enabled = true, skin = 'windows', tab, nonce = 0 }: { enabled?: boolean; skin?: DesktopSkin; tab: string; nonce?: number }) {
  const { wm } = useWindowManager({ enabled, skin, activeTab: tab, navNonce: nonce });
  return <i id="o" data-ids={wm.windows.map(w => w.tabId).join(',')} />;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (ui: ReactNode) => act(() => root.render(ui));

describe('useWindowManager: desktop mulai kosong (edge)', () => {
  it('mount pertama di bawah StrictMode (dev: efek dijalankan dua kali) tetap tidak membuka jendela', () => {
    render(<StrictMode><H tab="dashboard" /></StrictMode>);
    expect(read().count).toBe(0);
  });
  it('ganti skin windows -> mac saat sudah aktif tidak membuka jendela dan tidak menutup yang ada', () => {
    render(<H tab="dashboard" />);
    render(<H tab="dashboard" nonce={1} />);
    expect(read().ids).toEqual(['dashboard']);
    render(<H tab="dashboard" nonce={1} skin="mac" />);
    expect(read().ids).toEqual(['dashboard']);
  });
  it('activeTab non-jendela tidak membuka apa pun; berpindah ke tab jendela sesudah aktif membuka', () => {
    render(<H tab="suppliers" />);
    render(<H tab="suppliers" nonce={1} />);
    expect(read().count).toBe(0);
    render(<H tab="orders" nonce={2} />);
    expect(read().ids).toEqual(['orders']);
  });
  it('enabled false terus-menerus (Klasik) tidak pernah membuka jendela walau activeTab/nonce berubah', () => {
    render(<H enabled={false} tab="dashboard" />);
    render(<H enabled={false} tab="orders" nonce={3} />);
    expect(read().count).toBe(0);
  });
});

describe('DesktopBoot / useBootSkin', () => {
  it('SSR: useBootSkin mengembalikan null (tanpa localStorage/matchMedia) dan DesktopBoot merender status beraria', () => {
    function P() { return <span data-s={String(useBootSkin())} />; }
    expect(renderToString(<P />)).toContain('data-s="null"');
    const html = renderToString(<DesktopBoot skin="mac" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Memuat dashboard');
  });
});
