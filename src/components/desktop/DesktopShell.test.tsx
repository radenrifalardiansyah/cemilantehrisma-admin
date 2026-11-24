// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayoutDashboard, Receipt, Truck } from 'lucide-react';
import TopbarPortal from '@/components/TopbarPortal';
import DesktopShell, { type DesktopActions } from './DesktopShell';
import { useWindowManager } from './use-window-manager';
import type { DesktopGroup } from './types';
import { focusedTabId, type DesktopSkin } from './window-reducer';

vi.mock('next/image', () => ({ default: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const groups: DesktopGroup[] = [{
  id: 'm1', label: 'Utama', items: [
    { tab: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard, color: '#D4691E', windowed: true, badge: 0 },
    { tab: 'orders', label: 'Pesanan', Icon: Receipt, color: '#D4691E', windowed: true, badge: 3 },
    { tab: 'suppliers', label: 'Supplier', Icon: Truck, color: '#D4691E', windowed: false, badge: 0 },
  ],
}, {
  id: 'm2', label: 'Mitra', items: [
    { tab: 'consignment', label: 'Mitra', Icon: Truck, color: '#0284C7', windowed: true, badge: 0 },
    { tab: 'wa-forward', label: 'Teruskan Stok WA', Icon: Truck, color: '#0284C7', windowed: true, badge: 0 },
  ],
}];

const picked: string[] = [];
const focusedNow = () => document.getElementById('probe')!.dataset.focused || null;

function Harness({ skin, tab, nonce = 0 }: { skin: DesktopSkin; tab: string; nonce?: number }) {
  const { wm, dispatch } = useWindowManager({ enabled: true, skin, activeTab: tab, navNonce: nonce });
  const actions: DesktopActions = {
    open: t => dispatch({ type: 'open', tabId: t }), focus: t => dispatch({ type: 'focus', tabId: t }),
    minimize: t => dispatch({ type: 'minimize', tabId: t }), maximize: t => dispatch({ type: 'maximize', tabId: t }),
    close: t => dispatch({ type: 'close', tabId: t }), move: (t, x, y) => dispatch({ type: 'move', tabId: t, x, y }),
    resize: (t, r) => dispatch({ type: 'resize', tabId: t, ...r }), arrange: () => dispatch({ type: 'arrange' }), closeAll: () => dispatch({ type: 'closeAll' }),
  };
  const content: Record<string, ReactNode> = {
    dashboard: <div data-testid="dash">Isi dashboard<TopbarPortal><button id="refresh-btn">Refresh</button></TopbarPortal></div>,
    orders: <div data-testid="ord">Isi pesanan</div>,
    consignment: <div data-testid="cons">Isi Mitra<TopbarPortal><button id="cons-btn">Aksi</button></TopbarPortal></div>,
    'wa-forward': <div>wa</div>,
  };
  return (
    <>
      <div id="topbar-slot" />
      <div id="probe" data-focused={focusedTabId(wm) ?? ''} />
      <DesktopShell skin={skin} layout={skin} wm={wm} groups={groups} content={content} username="rifal" avatar={null} roleLabel="Administrator"
        storeUrl="https://x" renderBell={() => <button aria-label="Notifikasi">bel</button>} actions={actions}
        onPickMenu={i => { picked.push(i.tab); if (i.windowed) actions.open(i.tab); }} onChangeLayout={() => {}}
        onEditProfile={() => {}} onAbout={() => {}} onLogout={() => {}} />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  picked.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  HTMLElement.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; };
  if (!window.matchMedia) window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const render = (ui: ReactNode) => act(() => root.render(ui));
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });

describe('DesktopShell (skin Windows)', () => {
  it('activeTab berjendela membuka jendelanya; tombol TopbarPortal masuk ke titlebar jendela, bukan #topbar-slot', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    expect(q('[data-testid="dash"]')).not.toBeNull();
    const btn = q('#refresh-btn');
    expect(btn).not.toBeNull();
    expect(btn!.closest('.dsk-tbslot')).not.toBeNull();
    expect(q('#topbar-slot')!.children).toHaveLength(0);
    expect(q('.dsk-win')!.getAttribute('aria-label')).toBe('Dashboard');
  });

  it('singleton + taskbar: klik ikon meja dua kali tidak menggandakan; klik tombol taskbar memfokus/mengecilkan', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    const ico = q('button[aria-label="Buka Pesanan"]');
    click(ico); click(ico);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(2);
    expect(focusedNow()).toBe('orders');
    click(q('.dsk-tbtn[aria-label="Pesanan"]'));     // fokus -> kecilkan
    expect(q('.dsk-win[aria-label="Pesanan"]')!.hasAttribute('hidden')).toBe(true);
    expect(focusedNow()).toBe('dashboard');
    click(q('.dsk-tbtn[aria-label="Pesanan"]'));     // pulihkan
    expect(q('.dsk-win[aria-label="Pesanan"]')!.hasAttribute('hidden')).toBe(false);
    expect(focusedNow()).toBe('orders');
  });

  it('tombol tutup menghapus jendela; menutup jendela terakhir tidak membukanya lagi', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    click(q('.dsk-win .dsk-wb.x'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
  });

  it('menu Mulai memuat semua menu, menandai "Klasik" untuk yang belum berjendela; Esc menutup', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    click(q('button[aria-label="Menu Mulai"]'));
    expect(q('.dsk-menu')).not.toBeNull();
    const supplier = Array.from(document.querySelectorAll('.dsk-mi')).find(b => b.textContent?.includes('Supplier'))!;
    expect(supplier.textContent).toContain('Klasik');
    const orders = Array.from(document.querySelectorAll('.dsk-mi')).find(b => b.textContent?.includes('Pesanan'))!;
    expect(orders.textContent).not.toContain('Klasik');
    click(supplier);
    expect(picked).toEqual(['suppliers']);
    expect(q('.dsk-menu')).toBeNull();

    click(q('button[aria-label="Menu Mulai"]'));
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(q('.dsk-menu')).toBeNull();
  });

  it('footer menu Mulai: "Ganti tampilan" menampilkan pilihan tiga layout', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    click(q('button[aria-label="Menu Mulai"]'));
    expect(q('[role="radiogroup"]')).toBeNull();
    click(Array.from(document.querySelectorAll('.dsk-mfoot button')).find(b => b.textContent === 'Ganti tampilan')!);
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(3);
  });

  it('jendela dapat difokus keyboard dan semua tombol ikon punya aria-label', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    expect(q('.dsk-win')!.tabIndex).toBe(0);
    for (const b of document.querySelectorAll('.dsk-wb, .dsk-tl button, .dsk-start, .dsk-avatar')) {
      expect(b.getAttribute('aria-label') || b.textContent).toBeTruthy();
    }
  });
});

describe('DesktopShell (skin Mac)', () => {
  it('menu bar menampilkan judul jendela terdepan; dock memuat hanya menu berjendela + Launchpad', () => {
    render(<Harness skin="mac" tab="dashboard" />);
    expect(q('.dsk-mbar')!.textContent).toContain('Dashboard');
    const dockLabels = Array.from(document.querySelectorAll('.dsk-dock button')).map(b => b.getAttribute('aria-label'));
    expect(dockLabels).toEqual(['Launchpad', 'Dashboard', 'Pesanan', 'Mitra']);
    expect(q('.dsk-icons')).toBeNull();
    expect(q('.dsk-task')).toBeNull();
  });

  it('Launchpad dari dock; klik item dock jendela terdepan mengecilkannya', () => {
    render(<Harness skin="mac" tab="dashboard" />);
    click(q('.dsk-dock button[aria-label="Launchpad"]'));
    expect(q('.dsk-menu[data-variant="launchpad"]')).not.toBeNull();
    act(() => { q('.dsk-scrim')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(q('.dsk-menu')).toBeNull();
    click(q('.dsk-dock button[aria-label="Dashboard"]'));
    expect(q('.dsk-win')!.hasAttribute('hidden')).toBe(true);
  });
});

describe('sinkronisasi activeTab -> jendela', () => {
  it('permintaan ke tab yang sama (navNonce naik) membuka lagi jendela yang sudah ditutup; tanpa nonce tidak', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    click(q('.dsk-win .dsk-wb.x'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    render(<Harness skin="windows" tab="dashboard" />);      // render ulang biasa: tetap tertutup
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    render(<Harness skin="windows" tab="dashboard" nonce={1} />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
  });

  it('permintaan dari luar (activeTab berubah) membuka/memfokus jendela tab itu', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    expect(focusedNow()).toBe('dashboard');
    render(<Harness skin="windows" tab="orders" />);
    expect(focusedNow()).toBe('orders');
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(2);
    render(<Harness skin="windows" tab="suppliers" />);   // tab tak berjendela: tidak membuka apa pun
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(2);
  });
});

describe('Mitra berjendela (tahap 3)', () => {
  it('notifikasi consignment_* (activeTab = consignment) membuka jendela Mitra dengan tombol topbar di titlebarnya', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    render(<Harness skin="windows" tab="consignment" nonce={1} />);
    expect(focusedNow()).toBe('consignment');
    expect(q('[data-testid="cons"]')).not.toBeNull();
    expect(q('#cons-btn')!.closest('.dsk-tbslot')).not.toBeNull();
  });
  it('notifikasi kedua saat jendela Mitra sudah ditutup membuka lagi (navNonce); saat sudah terbuka tidak menggandakan', () => {
    render(<Harness skin="windows" tab="consignment" />);
    click(q('.dsk-win[aria-label="Mitra"] .dsk-wb.x'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    render(<Harness skin="windows" tab="consignment" nonce={1} />);
    render(<Harness skin="windows" tab="consignment" nonce={2} />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
  });
  it('ikon meja hanya pintasan: Teruskan Stok WA ada di menu Mulai tapi bukan ikon meja; di dock hanya saat jendelanya terbuka', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    const icons = Array.from(document.querySelectorAll('.dsk-ico')).map(b => b.getAttribute('aria-label'));
    expect(icons).toContain('Buka Mitra');
    expect(icons).not.toContain('Buka Teruskan Stok WA');
    click(q('button[aria-label="Menu Mulai"]'));
    expect(Array.from(document.querySelectorAll('.dsk-mi')).some(b => b.textContent?.includes('Teruskan Stok WA'))).toBe(true);
  });
  it('dock Mac memuat menu berjendela non-pintasan hanya selagi jendelanya terbuka', () => {
    render(<Harness skin="mac" tab="wa-forward" />);
    const labels = Array.from(document.querySelectorAll('.dsk-dock button')).map(b => b.getAttribute('aria-label'));
    expect(labels).toContain('Teruskan Stok WA');
    click(q('.dsk-win[aria-label="Teruskan Stok WA"] .dsk-tl .r'));
    expect(Array.from(document.querySelectorAll('.dsk-dock button')).map(b => b.getAttribute('aria-label'))).not.toContain('Teruskan Stok WA');
  });
});
