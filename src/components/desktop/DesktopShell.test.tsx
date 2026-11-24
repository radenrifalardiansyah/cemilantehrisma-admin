// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayoutDashboard, Receipt, Truck } from 'lucide-react';
import TopbarPortal from '@/components/TopbarPortal';
import DesktopShell, { type DesktopActions } from './DesktopShell';
import { useWindowManager } from './use-window-manager';
import type { DesktopGroup } from './types';
import type { Appearance } from '@/lib/appearance';
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

function Harness({ skin, tab, nonce = 0, enabled = true, bell, appearance, onOpenAppearance }: { skin: DesktopSkin; tab: string; nonce?: number; enabled?: boolean; bell?: ReactNode; appearance?: Appearance; onOpenAppearance?: () => void }) {
  const { wm, dispatch } = useWindowManager({ enabled, skin, activeTab: tab, navNonce: nonce });
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
    notifications: <div data-testid="notif">Isi notifikasi</div>,
  };
  return (
    <>
      <div id="topbar-slot" />
      <div id="probe" data-focused={focusedTabId(wm) ?? ''} />
      <DesktopShell appearance={appearance} onOpenAppearance={onOpenAppearance} skin={skin} layout={skin} wm={wm} groups={groups} content={content} username="rifal" avatar={null} roleLabel="Administrator"
        storeUrl="https://x" renderBell={() => bell ?? <button aria-label="Notifikasi">bel</button>} actions={actions}
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
// Desktop mulai kosong; navigasi eksplisit pertama (navNonce naik) membuka jendela tab aktif.
const mount = (skin: DesktopSkin, tab: string) => { render(<Harness skin={skin} tab={tab} />); render(<Harness skin={skin} tab={tab} nonce={1} />); };
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });

describe('DesktopShell (skin Windows)', () => {
  it('activeTab berjendela membuka jendelanya; tombol TopbarPortal masuk ke titlebar jendela, bukan #topbar-slot', () => {
    mount("windows", "dashboard");
    expect(q('[data-testid="dash"]')).not.toBeNull();
    const btn = q('#refresh-btn');
    expect(btn).not.toBeNull();
    expect(btn!.closest('.dsk-tbslot')).not.toBeNull();
    expect(q('#topbar-slot')!.children).toHaveLength(0);
    expect(q('.dsk-win')!.getAttribute('aria-label')).toBe('Dashboard');
  });

  it('singleton + taskbar: klik ikon meja dua kali tidak menggandakan; klik tombol taskbar memfokus/mengecilkan', () => {
    mount("windows", "dashboard");
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
    mount("windows", "dashboard");
    click(q('.dsk-win .dsk-wb.x'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
  });

  it('menu Mulai memuat semua menu, menandai "Klasik" untuk yang belum berjendela; Esc menutup', () => {
    mount("windows", "dashboard");
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
    mount("windows", "dashboard");
    click(q('button[aria-label="Menu Mulai"]'));
    expect(q('[role="radiogroup"]')).toBeNull();
    click(q('.dsk-mfoot button[aria-label="Ganti tampilan"]'));
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(3);
  });

  it('jendela dapat difokus keyboard dan semua tombol ikon punya aria-label', () => {
    mount("windows", "dashboard");
    expect(q('.dsk-win')!.tabIndex).toBe(0);
    for (const b of document.querySelectorAll('.dsk-wb, .dsk-tl button, .dsk-start, .dsk-avatar')) {
      expect(b.getAttribute('aria-label') || b.textContent).toBeTruthy();
    }
  });
});

describe('DesktopShell (skin Mac)', () => {
  it('menu bar menampilkan judul jendela terdepan; dock memuat hanya menu berjendela + Launchpad', () => {
    mount("mac", "dashboard");
    expect(q('.dsk-mbar')!.textContent).toContain('Dashboard');
    const dockLabels = Array.from(document.querySelectorAll('.dsk-dock button')).map(b => b.getAttribute('aria-label'));
    expect(dockLabels).toEqual(['Launchpad', 'Dashboard', 'Pesanan', 'Mitra']);
    expect(q('.dsk-icons')).toBeNull();
    expect(q('.dsk-task')).toBeNull();
  });

  it('Launchpad dari dock; klik item dock jendela terdepan mengecilkannya', () => {
    mount("mac", "dashboard");
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
    mount("windows", "dashboard");
    click(q('.dsk-win .dsk-wb.x'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    render(<Harness skin="windows" tab="dashboard" nonce={1} />);      // render ulang biasa (nonce sama): tetap tertutup
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    render(<Harness skin="windows" tab="dashboard" nonce={2} />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
  });

  it('permintaan dari luar (activeTab berubah) membuka/memfokus jendela tab itu', () => {
    mount("windows", "dashboard");
    expect(focusedNow()).toBe('dashboard');
    render(<Harness skin="windows" tab="orders" />);
    expect(focusedNow()).toBe('orders');
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(2);
    render(<Harness skin="windows" tab="consign" />);   // tab tak berjendela: tidak membuka apa pun
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(2);
  });
});

describe('Mitra berjendela (tahap 3)', () => {
  it('notifikasi consignment_* (activeTab = consignment) membuka jendela Mitra dengan tombol topbar di titlebarnya', () => {
    mount("windows", "dashboard");
    render(<Harness skin="windows" tab="consignment" nonce={1} />);
    expect(focusedNow()).toBe('consignment');
    expect(q('[data-testid="cons"]')).not.toBeNull();
    expect(q('#cons-btn')!.closest('.dsk-tbslot')).not.toBeNull();
  });
  it('notifikasi kedua saat jendela Mitra sudah ditutup membuka lagi (navNonce); saat sudah terbuka tidak menggandakan', () => {
    mount("windows", "consignment");
    click(q('.dsk-win[aria-label="Mitra"] .dsk-wb.x'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    render(<Harness skin="windows" tab="consignment" nonce={1} />);
    render(<Harness skin="windows" tab="consignment" nonce={2} />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
  });
  it('ikon meja hanya pintasan: Teruskan Stok WA ada di menu Mulai tapi bukan ikon meja; di dock hanya saat jendelanya terbuka', () => {
    mount("windows", "dashboard");
    const icons = Array.from(document.querySelectorAll('.dsk-ico')).map(b => b.getAttribute('aria-label'));
    expect(icons).toContain('Buka Mitra');
    expect(icons).not.toContain('Buka Teruskan Stok WA');
    click(q('button[aria-label="Menu Mulai"]'));
    expect(Array.from(document.querySelectorAll('.dsk-mi')).some(b => b.textContent?.includes('Teruskan Stok WA'))).toBe(true);
  });
  it('dock Mac memuat menu berjendela non-pintasan hanya selagi jendelanya terbuka', () => {
    mount("mac", "wa-forward");
    const labels = Array.from(document.querySelectorAll('.dsk-dock button')).map(b => b.getAttribute('aria-label'));
    expect(labels).toContain('Teruskan Stok WA');
    click(q('.dsk-win[aria-label="Teruskan Stok WA"] .dsk-tl .r'));
    expect(Array.from(document.querySelectorAll('.dsk-dock button')).map(b => b.getAttribute('aria-label'))).not.toContain('Teruskan Stok WA');
  });
});

describe('desktop mulai kosong', () => {
  it('mount pertama dengan activeTab berjendela TIDAK membuka jendela; ikon meja tetap ada; klik ikon membuka', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    expect(q('.dsk-task')).not.toBeNull();
    expect(document.querySelectorAll('.dsk-ico').length).toBeGreaterThan(0);
    click(q('button[aria-label="Buka Dashboard"]'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
  });
  it('Mac: kosong saat pertama, dock/menu bar ada', () => {
    render(<Harness skin="mac" tab="dashboard" />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    expect(q('.dsk-dock')).not.toBeNull();
    expect(q('.dsk-mbar')!.textContent).toContain('Desktop');
  });
  it('aktivasi setelah Klasik (enabled false -> true, mis. resize/ganti tampilan) juga kosong; navigasi sesudahnya membuka', () => {
    render(<Harness skin="windows" tab="dashboard" enabled={false} />);
    render(<Harness skin="windows" tab="dashboard" enabled />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    render(<Harness skin="windows" tab="dashboard" nonce={1} />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
  });
  it('jendela yang sudah ada tetap saat enabled mati lalu hidup lagi; tidak ada jendela baru otomatis', () => {
    mount('windows', 'orders');
    render(<Harness skin="windows" tab="orders" nonce={1} enabled={false} />);
    render(<Harness skin="windows" tab="orders" nonce={1} enabled />);
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
  });
});

describe('pengadaan berjendela (tahap 5)', () => {
  it('Hutang/stok_low (link materials) dan "Lihat GR" (goods-receipts) membuka jendelanya lewat activeTab; PO dan GR dua jendela terpisah', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    render(<Harness skin="windows" tab="goods-receipts" nonce={1} />);
    render(<Harness skin="windows" tab="purchase-orders" nonce={2} />);
    render(<Harness skin="windows" tab="materials" nonce={3} />);
    expect(Array.from(document.querySelectorAll('.dsk-win')).map(w => w.getAttribute('aria-label')).sort())
      .toEqual(['goods-receipts', 'materials', 'purchase-orders']);
    expect(focusedNow()).toBe('materials');
  });
});

describe('tray chat (skin Windows dan Mac)', () => {
  for (const skin of ['windows', 'mac'] as const) {
    it(`${skin}: slot tray chat ada tepat sebelum (di kiri) bel notifikasi`, () => {
      mount(skin, 'dashboard');
      const slot = q('.dsk-tray .dsk-chat-slot');
      expect(slot).not.toBeNull();
      expect(slot!.nextElementSibling!.querySelector('[aria-label="Notifikasi"]') ?? slot!.nextElementSibling!.getAttribute('aria-label')).toBeTruthy();
      expect(q(skin === 'mac' ? '.dsk-mbar .dsk-chat-slot' : '.dsk-task .dsk-chat-slot')).not.toBeNull();
    });
  }
});

// Meniru page.tsx: setActiveTab pembungkus menaikkan navNonce; AppShell memberi bel onViewAll = setActiveTab('notifications').
function WithBell({ skin }: { skin: DesktopSkin }) {
  const [tab, setTab] = useState('dashboard');
  const [nonce, setNonce] = useState(0);
  const go = (t: string) => { setTab(t); setNonce(n => n + 1); };
  return <Harness skin={skin} tab={tab} nonce={nonce} bell={<button aria-label="Lihat semua" onClick={() => go('notifications')}>bel</button>} />;
}

describe('"Lihat semua" dari bel membuka jendela Notifikasi (tahap 10)', () => {
  for (const skin of ['windows', 'mac'] as const) {
    it(`${skin}: membuka jendela, dan membuka lagi setelah ditutup walau activeTab sama`, () => {
      render(<WithBell skin={skin} />);
      expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
      click(q('button[aria-label="Lihat semua"]'));
      expect(focusedNow()).toBe('notifications');
      expect(q('[data-testid="notif"]')).not.toBeNull();
      click(q(skin === 'windows' ? '.dsk-win .dsk-wb.x' : '.dsk-win .dsk-tl .r'));
      expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
      click(q('button[aria-label="Lihat semua"]'));
      expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
    });
  }
});

describe('panel semua menu: ukuran tetap, footer ikon', () => {
  const type = (el: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const [skin, btn, variant] of [['windows', 'Menu Mulai', 'start'], ['mac', 'Launchpad', 'launchpad']] as const) {
    it(`${skin}: mengetik di kolom cari tidak mengubah wadah panel (inline style/kelas sama); tanpa hasil tampil "Tidak ada menu" di panel yang sama; Enter dan Esc tetap`, () => {
      mount(skin, 'dashboard');
      click(q(skin === 'windows' ? `button[aria-label="${btn}"]` : `.dsk-dock button[aria-label="${btn}"]`));
      const menu = q(`.dsk-menu[data-variant="${variant}"]`)!;
      const before = [menu.className, menu.getAttribute('style')];
      const input = q('.dsk-menu input[type="search"]') as HTMLInputElement;
      type(input, 'Pesan');
      expect(document.querySelectorAll('.dsk-mi').length).toBe(1);
      expect([menu.className, menu.getAttribute('style')]).toEqual(before);
      type(input, 'zzzz');
      expect(q('.dsk-menu .dsk-mscroll .dsk-empty')!.textContent).toBe('Tidak ada menu');
      expect(q(`.dsk-menu[data-variant="${variant}"]`)).toBe(menu);
      type(input, 'Pesan');
      act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      expect(q('.dsk-menu')).toBeNull();
      expect(focusedNow()).toBe('orders');
    });
  }
  it('footer: tiga tombol ikon saja (tanpa teks), aria-label dan title memuat teks aslinya', () => {
    mount('windows', 'dashboard');
    click(q('button[aria-label="Menu Mulai"]'));
    const btns = Array.from(document.querySelectorAll('.dsk-mfoot .row button'));
    expect(btns.map(b => b.getAttribute('aria-label'))).toEqual(['Ganti tampilan', 'Susun ulang jendela', 'Tutup semua']);
    for (const b of btns) { expect(b.textContent).toBe(''); expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label')); expect(b.querySelector('svg')).not.toBeNull(); }
  });
  it('Susun ulang dan Tutup semua tetap berfungsi dari ikon', () => {
    mount('windows', 'dashboard');
    click(q('button[aria-label="Menu Mulai"]'));
    click(q('.dsk-mfoot button[aria-label="Tutup semua"]'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
  });
});

describe('pengaturan tampilan terpasang di .dsk-root saja', () => {
  const ap: Appearance = { accent: 'blue', wallpaper: 'waves', density: 'relaxed', textSize: 'large' };
  it('data-density/data-text dan variabel aksen/latar hanya di .dsk-root; elemen di luar root bersih', () => {
    render(<Harness skin="windows" tab="dashboard" appearance={ap} />);
    const rootEl = q('.dsk-root')!;
    expect(rootEl.getAttribute('data-density')).toBe('relaxed');
    expect(rootEl.getAttribute('data-text')).toBe('large');
    expect(rootEl.style.getPropertyValue('--accent')).toBe('#2D69A4');
    expect(rootEl.style.getPropertyValue('--dsk-wallpaper')).not.toBe('');
    expect(Array.from(document.querySelectorAll('[data-density],[data-text]'))).toEqual([rootEl]);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
    expect(document.body.style.getPropertyValue('--accent')).toBe('');
  });
  it('default: atribut standar dan tanpa override aksen/latar', () => {
    render(<Harness skin="mac" tab="dashboard" />);
    const rootEl = q('.dsk-root')!;
    expect(rootEl.getAttribute('data-density')).toBe('standard');
    expect(rootEl.getAttribute('data-text')).toBe('standard');
    expect(rootEl.style.getPropertyValue('--accent')).toBe('');
    expect(rootEl.style.getPropertyValue('--dsk-wallpaper')).toBe('');
  });
  it('ikon Palet di footer panel menu dan item "Personalisasi" di menu akun muncul hanya bila ada pengelola; klik memanggilnya', () => {
    const open = vi.fn();
    mount('windows', 'dashboard');
    click(q('button[aria-label="Menu Mulai"]'));
    expect(q('.dsk-mfoot button[aria-label="Personalisasi"]')).toBeNull();
    act(() => root.unmount()); root = createRoot(host);
    render(<Harness skin="windows" tab="dashboard" onOpenAppearance={open} />);
    click(q('button[aria-label="Menu Mulai"]'));
    click(q('.dsk-mfoot button[aria-label="Personalisasi"]'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(q('.dsk-menu')).toBeNull();
    click(q('button[aria-label="Menu akun"]'));
    click(Array.from(document.querySelectorAll('.dsk-pop button')).find(b => b.textContent?.includes('Personalisasi'))!);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
