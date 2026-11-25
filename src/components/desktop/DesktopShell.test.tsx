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

function Harness({ skin, tab, nonce = 0, enabled = true, bell, appearance, onOpenAppearance, pins, onTogglePin }: { skin: DesktopSkin; tab: string; nonce?: number; enabled?: boolean; bell?: ReactNode; appearance?: Appearance; onOpenAppearance?: () => void; pins?: readonly string[]; onTogglePin?: (tab: string) => void }) {
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
      <DesktopShell appearance={appearance} onOpenAppearance={onOpenAppearance} pins={pins} onTogglePin={onTogglePin} skin={skin} layout={skin} wm={wm} groups={groups} content={content} username="rifal" avatar={null} roleLabel="Administrator"
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

describe('klik kanan pada scrim panel', () => {
  const rc = (el: Element) => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); act(() => { el.dispatchEvent(ev); }); return ev; };

  it('menu bawaan peramban dicegah, panel tetap terbuka, menu klik kanan kita tidak muncul', () => {
    mount("mac", "dashboard");
    click(q('.dsk-dock button[aria-label="Launchpad"]'));
    const ev = rc(q('.dsk-scrim')!);
    expect(ev.defaultPrevented).toBe(true);
    expect(q('.dsk-menu[data-variant="launchpad"]')).not.toBeNull();
    expect(q('.dsk-ctx')).toBeNull();
  });

  it('klik kanan di dalam panel tidak dicegat', () => {
    mount("mac", "dashboard");
    click(q('.dsk-dock button[aria-label="Launchpad"]'));
    const ev = rc(q('.dsk-menu input') ?? q('.dsk-menu')!);
    expect(ev.defaultPrevented).toBe(false);
    expect(q('.dsk-ctx')).toBeNull();
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
    render(<Harness skin="windows" tab="bukan-tab" />);   // tab tak berjendela: tidak membuka apa pun
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
    expect(q('.dsk-mbar')!.textContent).toContain('Cemilan Teh Risma');
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
  it('footer: tombol ikon saja (tanpa teks), aria-label dan title memuat teks aslinya', () => {
    mount('windows', 'dashboard');
    click(q('button[aria-label="Menu Mulai"]'));
    const btns = Array.from(document.querySelectorAll('.dsk-mfoot .row button'));
    expect(btns.map(b => b.getAttribute('aria-label'))).toEqual(['Keluar', 'Ganti tampilan', 'Susun ulang jendela', 'Tutup semua']);
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

describe('layar penuh browser (tray Windows dan menu bar Mac)', () => {
  let fsEl: Element | null = null;
  const enable = (v: boolean | undefined) => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => v });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
  };
  afterEach(() => { delete (document as unknown as Record<string, unknown>).fullscreenEnabled; delete (document as unknown as Record<string, unknown>).fullscreenElement; fsEl = null; });

  for (const skin of ['windows', 'mac'] as const) {
    it(`${skin}: tombol ada di paling kiri tray (sebelum slot chat dan bel), aria-pressed mengikuti state, klik memanggil requestFullscreen`, async () => {
      enable(true);
      const request = vi.fn(async () => { fsEl = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); });
      document.documentElement.requestFullscreen = request as unknown as () => Promise<void>;
      mount(skin, 'dashboard');
      const btn = q('.dsk-tray .dsk-fs-btn')!;
      expect(btn).not.toBeNull();
      expect(btn.nextElementSibling!.classList.contains('dsk-chat-slot')).toBe(true);
      expect(btn.getAttribute('aria-label')).toBe('Layar penuh');
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      await act(async () => { btn.click(); });
      expect(request).toHaveBeenCalledTimes(1);
      const after = q('.dsk-tray .dsk-fs-btn')!;
      expect(after.getAttribute('aria-pressed')).toBe('true');
      expect(after.getAttribute('aria-label')).toBe('Keluar dari layar penuh');
    });
    it(`${skin}: tidak didukung -> tombol tidak dirender`, () => {
      enable(false);
      mount(skin, 'dashboard');
      expect(q('.dsk-fs-btn')).toBeNull();
    });
  }

  it('menu akun memuat item layar penuh hanya bila didukung', () => {
    enable(true);
    mount('windows', 'dashboard');
    click(q('button[aria-label="Menu akun"]'));
    expect(Array.from(document.querySelectorAll('.dsk-pop button')).some(b => b.textContent?.includes('Layar penuh'))).toBe(true);
  });
});

describe('bintang: sematkan menu ke ikon meja / dock', () => {
  const icons = () => Array.from(document.querySelectorAll('.dsk-ico')).map(b => b.getAttribute('aria-label'));
  const dockLabels = () => Array.from(document.querySelectorAll('.dsk-dock .dsk-dk')).map(b => b.getAttribute('aria-label'));
  const star = (label: string) => q(`.dsk-menu .dsk-star[aria-label*="${label}"]`)!;

  it('tanpa pengelola pin: tidak ada bintang; panel tetap memuat semua menu', () => {
    mount('windows', 'dashboard');
    click(q('button[aria-label="Menu Mulai"]'));
    expect(document.querySelectorAll('.dsk-star')).toHaveLength(0);
    expect(document.querySelectorAll('.dsk-mi').length).toBe(5);
  });

  it('bintang adalah tombol saudara (bukan di dalam tombol menu); klik hanya memanggil onTogglePin dan TIDAK membuka jendela/menutup panel', () => {
    const toggle = vi.fn();
    render(<Harness skin="windows" tab="dashboard" onTogglePin={toggle} />);
    click(q('button[aria-label="Menu Mulai"]'));
    const s = star('Pesanan');
    expect(s.closest('.dsk-mi')).toBeNull();
    expect(s.tagName).toBe('BUTTON');
    click(s);
    expect(toggle).toHaveBeenCalledWith('orders');
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
    expect(q('.dsk-menu')).not.toBeNull();
  });

  it('status bintang mengikuti pin efektif (aria-pressed, label Sematkan/Lepas); default = pintasan bawaan', () => {
    render(<Harness skin="windows" tab="dashboard" onTogglePin={() => {}} />);   // pins undefined -> bawaan: dashboard, orders, consignment tersemat
    click(q('button[aria-label="Menu Mulai"]'));
    expect(star('Pesanan').getAttribute('aria-pressed')).toBe('true');
    expect(star('Pesanan').getAttribute('aria-label')).toBe('Lepas Pesanan dari desktop');
    expect(star('Teruskan Stok WA').getAttribute('aria-pressed')).toBe('false');
    expect(star('Teruskan Stok WA').getAttribute('aria-label')).toBe('Sematkan Teruskan Stok WA ke desktop');
  });

  it('Windows: ikon meja = daftar pin berurutan; id tak dikenal/menu hilang diabaikan; menu tak berjendela tanpa bintang', () => {
    render(<Harness skin="windows" tab="dashboard" pins={['wa-forward', 'bukan-tab', 'dashboard']} onTogglePin={() => {}} />);
    expect(icons()).toEqual(['Buka Teruskan Stok WA', 'Buka Dashboard']);
    click(q('button[aria-label="Menu Mulai"]'));
    expect(q('.dsk-menu .dsk-star[aria-label*="Supplier"]')).toBeNull();
  });

  it('Windows default (pins tidak diberikan): ikon meja = pintasan bawaan yang ada di nav', () => {
    render(<Harness skin="windows" tab="dashboard" />);
    expect(icons()).toEqual(['Buka Dashboard', 'Buka Pesanan', 'Buka Mitra']);
  });

  it('Mac: dock = Launchpad + pin berurutan + jendela terbuka non-pin; lepas pin menghapus ikon', () => {
    render(<Harness skin="mac" tab="dashboard" pins={['orders', 'dashboard']} />);
    expect(dockLabels()).toEqual(['Launchpad', 'Pesanan', 'Dashboard']);
    render(<Harness skin="mac" tab="dashboard" pins={['dashboard']} />);
    expect(dockLabels()).toEqual(['Launchpad', 'Dashboard']);
  });

  it('menyematkan menambah ikon meja (pin baru di akhir) dan melepas menghapusnya', () => {
    const initial = ['dashboard'];
    function Stateful() {
      const [pins, setPins] = useState<string[]>(initial);
      return <Harness skin="windows" tab="dashboard" pins={pins} onTogglePin={t => setPins(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]))} />;
    }
    render(<Stateful />);
    expect(icons()).toEqual(['Buka Dashboard']);
    click(q('button[aria-label="Menu Mulai"]'));
    click(star('Pesanan'));
    expect(icons()).toEqual(['Buka Dashboard', 'Buka Pesanan']);
    click(star('Dashboard'));
    expect(icons()).toEqual(['Buka Pesanan']);
  });
});

describe('menu klik kanan dan pintasan keyboard', () => {
  const rclick = (el: Element | null, x = 120, y = 90) => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    act(() => { el!.dispatchEvent(e); });
    return e;
  };
  const ctxLabels = () => Array.from(document.querySelectorAll('.dsk-ctx [role^="menuitem"]')).map(i => i.textContent);
  const ctxItem = (t: string) => Array.from(document.querySelectorAll('.dsk-ctx [role^="menuitem"]')).find(i => i.textContent === t) ?? null;

  it('wallpaper (area kosong): menu desktop dengan item benar; hanya satu menu pada satu waktu', () => {
    mount('windows', 'dashboard');
    const e = rclick(q('.dsk-root'));
    expect(e.defaultPrevented).toBe(true);
    expect(ctxLabels()).toEqual(['Susun ulang jendela', 'Tutup semua jendela', 'Tampilan Klasik', 'Tampilan Windows', 'Tampilan Mac', 'Pintasan keyboard']);
    expect(document.querySelectorAll('.dsk-ctx')).toHaveLength(1);
    rclick(q('.dsk-root'), 300, 200);
    expect(document.querySelectorAll('.dsk-ctx')).toHaveLength(1);
  });

  it('wallpaper: Personalisasi hanya bila ada pengelola; Susun ulang/Tutup semua aktif saat ada jendela; Tutup semua menutup jendela', () => {
    const onAp = vi.fn();
    render(<Harness skin="windows" tab="dashboard" onOpenAppearance={onAp} />);
    click(q('button[aria-label="Buka Dashboard"]'));
    rclick(q('.dsk-root'));
    expect(ctxLabels()?.[0]).toBe('Personalisasi');
    expect((ctxItem('Tutup semua jendela') as HTMLButtonElement).disabled).toBe(false);
    click(ctxItem('Personalisasi')); expect(onAp).toHaveBeenCalledTimes(1);
    expect(q('.dsk-ctx')).toBeNull();
    rclick(q('.dsk-root'));
    click(ctxItem('Tutup semua jendela'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
  });

  it('wallpaper: "Pintasan keyboard" membuka dialog daftar pintasan', () => {
    mount('windows', 'dashboard');
    rclick(q('.dsk-root')); click(ctxItem('Pintasan keyboard'));
    expect(document.querySelector('[aria-label="Daftar pintasan"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Alt + J');
  });

  it('ikon meja Windows: Buka / Sematkan-Lepas; Buka membuka jendela; Lepas memanggil onTogglePin', () => {
    const toggle = vi.fn();
    render(<Harness skin="windows" tab="dashboard" onTogglePin={toggle} />);
    rclick(q('button[aria-label="Buka Pesanan"]'));
    expect(ctxLabels()).toEqual(['Buka', 'Lepas dari desktop']);
    click(ctxItem('Buka'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
    rclick(q('button[aria-label="Buka Pesanan"]'));
    expect(ctxLabels()).toEqual(['Fokus', 'Kecilkan', 'Maksimalkan', 'Tutup', 'Lepas dari desktop']);
    click(ctxItem('Lepas dari desktop'));
    expect(toggle).toHaveBeenCalledWith('orders');
  });

  it('tombol jendela di taskbar: Fokus/Kecilkan/Maksimalkan/Tutup; Kecilkan dan Tutup bekerja', () => {
    mount('windows', 'dashboard');
    rclick(q('.dsk-tbtn[aria-label="Dashboard"]'));
    expect(ctxLabels()).toEqual(['Fokus', 'Kecilkan', 'Maksimalkan', 'Tutup']);
    click(ctxItem('Kecilkan'));
    expect(q('.dsk-win')!.hasAttribute('hidden')).toBe(true);
    rclick(q('.dsk-tbtn[aria-label="Dashboard"]'));
    expect(ctxLabels()?.[0]).toBe('Pulihkan');
    click(ctxItem('Tutup'));
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(0);
  });

  it('dock Mac: klik kanan item membuka menu itemnya; pin non-jendela bisa Disematkan dari item terbuka', () => {
    const toggle = vi.fn();
    render(<Harness skin="mac" tab="dashboard" pins={['dashboard']} onTogglePin={toggle} />);
    click(q('.dsk-dock button[aria-label="Dashboard"]'));
    rclick(q('.dsk-dock button[aria-label="Dashboard"]'));
    expect(ctxLabels()).toContain('Lepas dari desktop');
    click(ctxItem('Lepas dari desktop')); expect(toggle).toHaveBeenCalledWith('dashboard');
  });

  it('klik kanan DI DALAM jendela (titlebar, isi, kolom isian) tidak dicegat: menu bawaan peramban tetap', () => {
    mount('windows', 'dashboard');
    for (const target of [q('.dsk-win'), q('.dsk-tb'), q('.dsk-body'), q('[data-testid="dash"]')]) {
      const e = rclick(target);
      expect(e.defaultPrevented).toBe(false);
    }
    const input = document.createElement('input'); q('.dsk-body')!.appendChild(input);
    expect(rclick(input).defaultPrevented).toBe(false);
    expect(q('.dsk-ctx')).toBeNull();
  });

  it('Esc menutup menu klik kanan', () => {
    mount('windows', 'dashboard');
    rclick(q('.dsk-root'));
    act(() => { q('.dsk-ctx')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(q('.dsk-ctx')).toBeNull();
  });

  it('pintasan: Alt+W menutup jendela aktif, Alt+J pindah jendela, Alt+K membuka panel menu (Klasik tidak punya DesktopShell)', () => {
    mount('windows', 'dashboard');
    click(q('button[aria-label="Buka Pesanan"]'));
    expect(focusedNow()).toBe('orders');
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', altKey: true, bubbles: true, cancelable: true })); });
    expect(focusedNow()).toBe('dashboard');
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', altKey: true, bubbles: true, cancelable: true })); });
    expect(document.querySelectorAll('.dsk-win')).toHaveLength(1);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', altKey: true, bubbles: true, cancelable: true })); });
    expect(q('.dsk-menu')).not.toBeNull();
  });
});
