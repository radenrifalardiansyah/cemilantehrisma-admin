// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayoutDashboard, Receipt, Truck } from 'lucide-react';
import MenuBarMenus from './MenuBarMenu';
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
    { tab: 'consignment', label: 'Mitra', Icon: Truck, color: '#0284C7', windowed: true, badge: 0 },
  ],
}];

const calls: string[] = [];
const focusedNow = () => document.getElementById('probe')!.dataset.focused || null;

function Harness({ skin, pins, onTogglePin, nonce = 0, tab = 'dashboard' }: { skin: DesktopSkin; pins?: readonly string[]; onTogglePin?: (t: string) => void; nonce?: number; tab?: string }) {
  const { wm, dispatch } = useWindowManager({ enabled: true, skin, activeTab: tab, navNonce: nonce });
  const actions: DesktopActions = {
    open: t => dispatch({ type: 'open', tabId: t }), focus: t => dispatch({ type: 'focus', tabId: t }),
    minimize: t => dispatch({ type: 'minimize', tabId: t }), maximize: t => dispatch({ type: 'maximize', tabId: t }),
    close: t => dispatch({ type: 'close', tabId: t }), move: (t, x, y) => dispatch({ type: 'move', tabId: t, x, y }),
    resize: (t, r) => dispatch({ type: 'resize', tabId: t, ...r }), arrange: () => dispatch({ type: 'arrange' }), closeAll: () => dispatch({ type: 'closeAll' }),
  };
  const content: Record<string, ReactNode> = { dashboard: <div>d</div>, orders: <div>o</div>, consignment: <div>c</div> };
  return (
    <>
      <div id="probe" data-focused={focusedTabId(wm) ?? ''} />
      <DesktopShell pins={pins} onTogglePin={onTogglePin} skin={skin} layout={skin} wm={wm} groups={groups} content={content} username="rifal" avatar={null} roleLabel="Administrator"
        storeUrl="https://x" renderBell={() => <button aria-label="Notifikasi">bel</button>} actions={actions}
        onPickMenu={i => { calls.push(`pick:${i.tab}`); if (i.windowed) actions.open(i.tab); }} onChangeLayout={l => calls.push(`layout:${l}`)}
        onOpenAppearance={() => calls.push('appearance')} onEditProfile={() => calls.push('profile')} onAbout={() => calls.push('about')} onLogout={() => calls.push('logout')} />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  calls.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  HTMLElement.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; };
  if (!window.matchMedia) window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const render = (ui: ReactNode) => act(() => root.render(ui));
const mount = (skin: DesktopSkin, props: { pins?: readonly string[]; onTogglePin?: (t: string) => void } = {}) => {
  render(<Harness skin={skin} tab="dashboard" {...props} />); render(<Harness skin={skin} tab="dashboard" nonce={1} {...props} />);
};
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qa = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
const key = (el: Element | null, k: string) => act(() => { (el as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const hover = (el: Element | null) => act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
const type = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const openStart = () => click(q('button[aria-label="Menu Mulai"]'));
const pinned = () => qa('.dsk-pt').map(e => e.dataset.menuTab);

describe('menu Mulai: bagian Disematkan', () => {
  it('menampilkan pin efektif berurutan (id tak dikenal/tak berjendela diabaikan)', () => {
    mount('windows', { pins: ['orders', 'bukan-tab', 'suppliers', 'dashboard'] });
    openStart();
    expect(pinned()).toEqual(['orders', 'dashboard']);
    expect(qa('.dsk-pb .lbl').map(e => e.textContent)).toEqual(['Pesanan', 'Dashboard']);
    expect(q('.dsk-mall')!.textContent).toBe('Semua menu');
  });

  it('klik ubin membuka jendela dan menutup panel tanpa mengubah pin', () => {
    const toggle = vi.fn();
    mount('windows', { pins: ['orders'], onTogglePin: toggle });
    openStart();
    click(q('.dsk-pt[data-menu-tab="orders"] .dsk-pb'));
    expect(toggle).not.toHaveBeenCalled();
    expect(focusedNow()).toBe('orders');
    expect(q('.dsk-menu')).toBeNull();
  });

  it('bintang di ubin (saudara tombol ubin) melepas pin saja; panel tetap terbuka dan jendela tidak dibuka', () => {
    const toggle = vi.fn();
    mount('windows', { pins: ['orders'], onTogglePin: toggle });
    const before = focusedNow();
    openStart();
    const s = q('.dsk-pt .dsk-pstar')!;
    expect(s.closest('.dsk-pb')).toBeNull();
    expect(s.getAttribute('aria-label')).toBe('Lepas Pesanan dari desktop');
    click(s);
    expect(toggle).toHaveBeenCalledWith('orders');
    expect(q('.dsk-menu')).not.toBeNull();
    expect(focusedNow()).toBe(before);
  });

  it('pin kosong menampilkan petunjuk; daftar Semua menu tetap memiliki bintang', () => {
    mount('windows', { pins: [], onTogglePin: () => {} });
    openStart();
    expect(q('.dsk-phint')!.textContent).toBe('Sematkan menu dengan bintang di daftar di bawah');
    expect(qa('.dsk-pt')).toHaveLength(0);
    expect(qa('.dsk-menu .dsk-star').length).toBeGreaterThan(0);
  });

  it('pencarian menyembunyikan Disematkan, wadah panel tidak berubah; Enter membuka hasil pertama; "Tidak ada menu" bila kosong', () => {
    mount('windows', { pins: ['orders'], onTogglePin: () => {} });
    openStart();
    const menu = q('.dsk-menu')!;
    const before = [menu.className, menu.getAttribute('style')];
    const input = q('.dsk-menu input[type="search"]') as HTMLInputElement;
    type(input, 'Mitra');
    expect(q('.dsk-pinned')).toBeNull();
    expect(q('.dsk-mall')).toBeNull();
    expect([menu.className, menu.getAttribute('style')]).toEqual(before);
    type(input, 'zzzz');
    expect(q('.dsk-mscroll .dsk-empty')!.textContent).toBe('Tidak ada menu');
    type(input, 'Mitra');
    key(input, 'Enter');
    expect(focusedNow()).toBe('consignment');
    expect(q('.dsk-menu')).toBeNull();
  });

  it('baris menu punya title berisi nama lengkap (tooltip saat label terpotong)', () => {
    mount('windows', { pins: [] });
    openStart();
    expect(qa('.dsk-mi').map(b => b.getAttribute('title'))).toEqual(expect.arrayContaining(['Dashboard', 'Pesanan', 'Supplier (dibuka dengan tampilan Klasik)']));
  });

  it('Esc menutup panel', () => {
    mount('windows', { pins: [] });
    openStart();
    key(document.body, 'Escape');
    expect(q('.dsk-menu')).toBeNull();
  });

  it('footer: baris pengguna membuka menu akun (Esc menutup popover dulu); tombol Keluar memanggil logout dan menutup panel', () => {
    mount('windows', { pins: [] });
    openStart();
    const user = q('.dsk-muser')!;
    expect(user.textContent).toContain('rifal');
    expect(user.textContent).toContain('Administrator');
    click(user);
    expect(q('.dsk-menu .dsk-pop')).not.toBeNull();
    key(document.body, 'Escape');
    expect(q('.dsk-menu .dsk-pop')).toBeNull();
    expect(q('.dsk-menu')).not.toBeNull();
    click(user);
    click(qa('.dsk-menu .dsk-pop [role="menuitem"]').find(b => b.textContent?.includes('Edit Profil'))!);
    expect(calls).toContain('profile');
    expect(q('.dsk-menu')).toBeNull();
    openStart();
    click(q('.dsk-mfoot button[aria-label="Keluar"]'));
    expect(calls).toContain('logout');
    expect(q('.dsk-menu')).toBeNull();
  });
});

describe('menu bar Mac', () => {
  const trig = (label: string) => qa('.dsk-mtrig').find(b => b.textContent === label || b.getAttribute('aria-label') === label)!;
  const items = () => qa('.dsk-mdrop [role^="menuitem"]');
  const item = (label: string) => items().find(b => b.textContent === label)!;

  it('menu Apple/Jendela/Tampilan/Bantuan ada; nama aplikasi = judul jendela terdepan, atau nama toko bila tak ada jendela', () => {
    render(<Harness skin="mac" tab="dashboard" />);
    expect(q('.dsk-mapp')!.textContent).toBe('Cemilan Teh Risma');
    expect(q('[role="menubar"]')).not.toBeNull();
    render(<Harness skin="mac" tab="dashboard" nonce={1} />);
    expect(q('.dsk-mapp')!.textContent).toBe('Dashboard');
    expect(qa('.dsk-mtrig').map(b => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Menu Cemilan Teh Risma', 'Jendela', 'Tampilan', 'Bantuan']);
  });

  it('menu Apple: item memanggil aksi yang benar dan menutup dropdown', () => {
    mount('mac');
    const open = () => click(qa('.dsk-mtrig')[0]);
    open(); click(item('Tentang aplikasi')); expect(calls).toEqual(['about']); expect(q('.dsk-mdrop')).toBeNull();
    open(); click(item('Personalisasi')); expect(calls.at(-1)).toBe('appearance');
    open(); click(item('Klasik')); expect(calls.at(-1)).toBe('layout:classic');
    open(); expect(item('Mac').getAttribute('aria-checked')).toBe('true'); expect(item('Klasik').getAttribute('aria-checked')).toBe('false');
    click(item('Edit Profil')); expect(calls.at(-1)).toBe('profile');
    open(); click(item('Keluar')); expect(calls.at(-1)).toBe('logout');
  });

  it('menu Jendela: Kecilkan/Maksimalkan/Tutup memengaruhi jendela terdepan; daftar jendela dengan centang fokus', () => {
    mount('mac');
    click(q('.dsk-dock button[aria-label="Pesanan"]') ?? null);
    expect(focusedNow()).toBe('orders');
    click(trig('Jendela'));
    expect(item('Maksimalkan')).toBeDefined();
    const wins = items().filter(b => b.getAttribute('role') === 'menuitemcheckbox');
    expect(wins.map(b => [b.textContent, b.getAttribute('aria-checked')])).toEqual([['Dashboard', 'false'], ['Pesanan', 'true']]);
    click(item('Dashboard'));
    expect(focusedNow()).toBe('dashboard');
    click(trig('Jendela')); click(item('Maksimalkan'));
    click(trig('Jendela')); expect(item('Pulihkan')).toBeDefined(); click(item('Kecilkan'));
    expect(focusedNow()).toBe('orders');
    click(trig('Jendela'));
    expect(item('Dashboard (dikecilkan)')).toBeDefined();
    click(item('Dashboard (dikecilkan)'));
    expect(focusedNow()).toBe('dashboard');
    click(trig('Jendela')); click(item('Tutup jendela'));
    expect(qa('.dsk-win')).toHaveLength(1);
    click(trig('Jendela')); click(item('Tutup semua'));
    expect(qa('.dsk-win')).toHaveLength(0);
  });

  it('tanpa jendela: Kecilkan/Maksimalkan/Tutup/Susun ulang/Tutup semua disabled', () => {
    render(<Harness skin="mac" tab="dashboard" />);
    click(trig('Jendela'));
    for (const l of ['Kecilkan', 'Maksimalkan', 'Tutup jendela', 'Susun ulang', 'Tutup semua']) expect((item(l) as HTMLButtonElement).disabled, l).toBe(true);
    expect(item('Tidak ada jendela terbuka')).toBeDefined();
  });

  it('menu Tampilan dan Bantuan; "Pintasan keyboard" tampil karena DesktopShell menyediakan aksinya', () => {
    mount('mac');
    click(trig('Tampilan'));
    expect(items().map(b => b.textContent)).toEqual(expect.arrayContaining(['Personalisasi', 'Klasik', 'Windows', 'Mac']));
    click(trig('Bantuan'));
    expect(items().map(b => b.textContent)).toEqual(['Tentang aplikasi', 'Pintasan keyboard']);
    click(item('Tentang aplikasi'));
    expect(calls).toEqual(['about']);
  });

  it('hover berpindah menu saat sudah ada yang terbuka (tidak membuka bila belum); aria-expanded mengikuti', () => {
    mount('mac');
    hover(trig('Tampilan'));
    expect(q('.dsk-mdrop')).toBeNull();
    click(trig('Jendela'));
    hover(trig('Bantuan'));
    expect(qa('.dsk-mdrop')).toHaveLength(1);
    expect(q('.dsk-mdrop')!.getAttribute('aria-label')).toBe('Bantuan');
    expect(trig('Bantuan').getAttribute('aria-expanded')).toBe('true');
    expect(trig('Jendela').getAttribute('aria-expanded')).toBe('false');
  });

  it('Esc menutup dan mengembalikan fokus ke pemicu; klik di luar menutup; listener bersih setelah tutup', () => {
    mount('mac');
    const t = trig('Jendela');
    click(t);
    key(document.body, 'Escape');
    expect(q('.dsk-mdrop')).toBeNull();
    expect(document.activeElement).toBe(t);
    click(t);
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(q('.dsk-mdrop')).toBeNull();
    key(document.body, 'Escape'); // tidak error tanpa lapisan
    expect(q('.dsk-mdrop')).toBeNull();
  });

  it('panah: kiri/kanan antar menu, atas/bawah antar item (melingkar, melewati disabled)', () => {
    mount('mac');
    const t = trig('Jendela');
    act(() => t.focus());
    key(t, 'ArrowDown');
    expect(q('.dsk-mdrop')!.getAttribute('aria-label')).toBe('Jendela');
    expect(document.activeElement).toBe(item('Kecilkan'));
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(item('Maksimalkan'));
    key(document.activeElement, 'ArrowUp'); key(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(items().filter(b => !(b as HTMLButtonElement).disabled).at(-1));
    key(document.activeElement, 'ArrowRight');
    expect(q('.dsk-mdrop')!.getAttribute('aria-label')).toBe('Tampilan');
    expect(document.activeElement?.closest('.dsk-mdrop')).not.toBeNull();
    key(document.activeElement, 'ArrowLeft'); key(document.activeElement, 'ArrowLeft');
    expect(q('.dsk-mdrop')!.getAttribute('aria-label')).toBe('Menu Cemilan Teh Risma');
    key(document.activeElement, 'Escape');
    // dari pemicu: kanan memindah fokus ke pemicu berikutnya
    const apple = trig('Menu Cemilan Teh Risma');
    act(() => apple.focus());
    key(apple, 'ArrowRight');
    expect(document.activeElement).toBe(trig('Jendela'));
  });

  it('Windows: tidak ada menu bar Mac', () => {
    mount('windows');
    expect(q('[role="menubar"]')).toBeNull();
  });
});

describe('state toggle pin tidak terpengaruh panel', () => {
  it('melepas lalu menyematkan lewat bintang daftar menambah ubin di akhir', () => {
    function Stateful() {
      const [pins, setPins] = useState<string[]>(['dashboard']);
      return <Harness skin="windows" tab="dashboard" pins={pins} onTogglePin={t => setPins(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]))} />;
    }
    render(<Stateful />);
    openStart();
    click(q('.dsk-menu .dsk-star[aria-label*="Pesanan"]'));
    expect(pinned()).toEqual(['dashboard', 'orders']);
    click(q('.dsk-pt[data-menu-tab="dashboard"] .dsk-pstar'));
    expect(pinned()).toEqual(['orders']);
  });
});

describe('fokus setelah memilih item menu bar', () => {
  const trigger = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('.dsk-mtrig')).find(b => b.textContent === label)!;
  const pick = (label: string) => click(Array.from(document.querySelectorAll<HTMLElement>('.dsk-mdrop [role^="menuitem"]')).find(b => b.textContent === label)!);

  it('item biasa (Kecilkan) dan Layar penuh mengembalikan fokus ke pemicu', () => {
    mount('mac');
    click(trigger('Jendela')); pick('Kecilkan');
    expect(q('.dsk-mdrop')).toBeNull();
    expect(document.activeElement).toBe(trigger('Jendela'));
    click(trigger('Tampilan')); pick('Personalisasi');
    expect(document.activeElement).toBe(trigger('Tampilan'));
  });

  it('item pembuka dialog tidak merebut fokus dari dialog: fokus dikembalikan dulu, baru aksi', () => {
    function Probe() {
      return (<>
        <input id="dlg" />
        <MenuBarMenus menus={[{ id: 'm', label: 'M', entries: [{ kind: 'item', id: 'a', label: 'Buka dialog', onSelect: () => document.getElementById('dlg')!.focus() }] }]} />
      </>);
    }
    render(<Probe />);
    click(q('.dsk-mtrig'));
    click(q('.dsk-mdrop [role="menuitem"]'));
    expect(document.activeElement).toBe(q('#dlg'));
  });
});
