import { describe, expect, it, vi } from 'vitest';
import { AppWindow } from 'lucide-react';
import { desktopMenu, itemMenu, widgetMenu, type ItemMenuCtx } from './context-menu-items';

const ctx = (over: Partial<ItemMenuCtx> = {}): ItemMenuCtx => ({
  tab: 'orders', pinned: true, onTogglePin: vi.fn(), open: vi.fn(), focus: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(), ...over,
});
const ids = (m: { id: string; separator?: boolean }[]) => m.filter(i => !i.separator).map(i => i.id);

describe('itemMenu', () => {
  it('jendela belum terbuka: Buka + sematkan/lepas; Buka memanggil open', () => {
    const c = ctx({ pinned: false });
    const m = itemMenu(c);
    expect(ids(m)).toEqual(['open', 'pin']);
    expect(m.find(i => i.id === 'pin')!.label).toBe('Sematkan ke desktop');
    m[0].onSelect!(); expect(c.open).toHaveBeenCalledWith('orders');
  });
  it('jendela terbuka: Fokus/Kecilkan/Maksimalkan/Tutup + lepas dari desktop; aksi memanggil actions yang benar', () => {
    const c = ctx({ win: { minimized: false, maximized: false, focused: true } });
    const m = itemMenu(c);
    expect(ids(m)).toEqual(['focus', 'min', 'max', 'close', 'pin']);
    expect(m.find(i => i.id === 'pin')!.label).toBe('Lepas dari desktop');
    for (const id of ['focus', 'min', 'max', 'close', 'pin']) m.find(i => i.id === id)!.onSelect!();
    expect(c.open).toHaveBeenCalledWith('orders'); expect(c.minimize).toHaveBeenCalledWith('orders'); expect(c.maximize).toHaveBeenCalledWith('orders');
    expect(c.close).toHaveBeenCalledWith('orders'); expect(c.onTogglePin).toHaveBeenCalledWith('orders');
  });
  it('jendela dikecilkan: "Pulihkan" menggantikan Fokus dan Kecilkan dinonaktifkan; maksimal: "Pulihkan ukuran"', () => {
    const m = itemMenu(ctx({ win: { minimized: true, maximized: false, focused: false } }));
    expect(m.find(i => i.id === 'focus')!.label).toBe('Pulihkan');
    expect(m.find(i => i.id === 'min')!.disabled).toBe(true);
    expect(itemMenu(ctx({ win: { minimized: false, maximized: true, focused: true } })).find(i => i.id === 'max')!.label).toBe('Pulihkan ukuran');
  });
  it('tanpa pengelola pin: tidak ada item sematkan', () => {
    expect(ids(itemMenu(ctx({ onTogglePin: undefined })))).toEqual(['open']);
  });
});

describe('desktopMenu', () => {
  const base = () => ({ hasWindows: true, layout: 'windows' as const, onAppearance: vi.fn(), arrange: vi.fn(), closeAll: vi.fn(), changeLayout: vi.fn(), showShortcuts: vi.fn() });
  it('memuat Personalisasi, susun ulang, tutup semua, pilihan tampilan (centang pada yang aktif), layar penuh, pintasan', () => {
    const c = { ...base(), fullscreen: { isFullscreen: false, onToggle: vi.fn() } };
    const m = desktopMenu(c);
    expect(ids(m)).toEqual(['appearance', 'arrange', 'closeall', 'layout-classic', 'layout-windows', 'layout-mac', 'fullscreen', 'shortcuts']);
    expect(m.find(i => i.id === 'layout-windows')!.checked).toBe(true);
    expect(m.find(i => i.id === 'layout-mac')!.checked).toBe(false);
    expect(m.find(i => i.id === 'fullscreen')!.label).toBe('Layar penuh');
    for (const id of ['appearance', 'arrange', 'closeall', 'layout-mac', 'fullscreen', 'shortcuts']) m.find(i => i.id === id)!.onSelect!();
    expect(c.onAppearance).toHaveBeenCalled(); expect(c.arrange).toHaveBeenCalled(); expect(c.closeAll).toHaveBeenCalled();
    expect(c.changeLayout).toHaveBeenCalledWith('mac'); expect(c.fullscreen.onToggle).toHaveBeenCalled(); expect(c.showShortcuts).toHaveBeenCalled();
  });
  it('tanpa jendela: susun ulang dan tutup semua nonaktif; memilih layout yang sedang aktif tidak memanggil changeLayout', () => {
    const c = { ...base(), hasWindows: false };
    const m = desktopMenu(c);
    expect(m.find(i => i.id === 'arrange')!.disabled).toBe(true);
    expect(m.find(i => i.id === 'closeall')!.disabled).toBe(true);
    m.find(i => i.id === 'layout-windows')!.onSelect!();
    expect(c.changeLayout).not.toHaveBeenCalled();
  });
  it('layar penuh tidak didukung dan Personalisasi tidak tersedia: item disembunyikan; label berganti saat layar penuh aktif', () => {
    expect(ids(desktopMenu({ ...base(), onAppearance: undefined }))).toEqual(['arrange', 'closeall', 'layout-classic', 'layout-windows', 'layout-mac', 'shortcuts']);
    expect(desktopMenu({ ...base(), fullscreen: { isFullscreen: true, onToggle: vi.fn() } }).find(i => i.id === 'fullscreen')!.label).toBe('Keluar dari layar penuh');
  });
});

describe('widgetMenu dan item "Tambah widget"', () => {
  it('widgetMenu: hanya ukuran yang diizinkan, centang ukuran saat ini, Hapus berbahaya; memilih ukuran sama tidak memanggil', () => {
    const onSize = vi.fn(); const onRemove = vi.fn();
    const items = widgetMenu({ size: 'm', allowedSizes: ['m', 'l'], onSize, onRemove });
    expect(items.filter(i => !i.separator).map(i => i.label)).toEqual(['Ukuran Sedang', 'Ukuran Lebar', 'Hapus widget']);
    expect(items.find(i => i.id === 'size-m')!.checked).toBe(true);
    expect(items.find(i => i.id === 'size-l')!.checked).toBe(false);
    expect(items.find(i => i.id === 'remove')!.danger).toBe(true);
    items.find(i => i.id === 'size-m')!.onSelect!(); expect(onSize).not.toHaveBeenCalled();
    items.find(i => i.id === 'size-l')!.onSelect!(); expect(onSize).toHaveBeenCalledWith('l');
    items.find(i => i.id === 'remove')!.onSelect!(); expect(onRemove).toHaveBeenCalled();
  });
  it('desktopMenu: item tambah widget hanya bila ada pengelola; disabled mengikuti entri', () => {
    const base = { hasWindows: false, layout: 'windows' as const, arrange: () => {}, closeAll: () => {}, changeLayout: () => {}, showShortcuts: () => {} };
    expect(desktopMenu(base).some(i => i.id.startsWith('widget-add-'))).toBe(false);
    expect(desktopMenu({ ...base, widgets: { add: [], onAdd: () => {} } }).some(i => i.id.startsWith('widget-add-'))).toBe(false);
    const onAdd = vi.fn();
    const items = desktopMenu({ ...base, widgets: { add: [{ type: 'clock', label: 'Jam & tanggal', Icon: AppWindow }, { type: 'note', label: 'Catatan tempel', Icon: AppWindow, disabled: true }], onAdd } });
    const a = items.find(i => i.id === 'widget-add-clock')!; const b = items.find(i => i.id === 'widget-add-note')!;
    expect(a.label).toBe('Tambah widget: Jam & tanggal'); expect(a.disabled).toBeFalsy(); expect(b.disabled).toBe(true);
    a.onSelect!(); expect(onAdd).toHaveBeenCalledWith('clock');
  });
});
