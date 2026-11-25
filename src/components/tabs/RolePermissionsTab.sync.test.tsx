// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import { DataSyncProvider, useBumpData } from '@/lib/data-sync';
import RolePermissionsTab from './RolePermissionsTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: Record<string, number> = {};
let roles = [{ id: 'kasir', name: 'Kasir', isSystem: false }];
let failRoles = false;
let failMenus = false;
let menuData = { modules: [{ id: 'm1', name: 'Operasional', icon: 'Package', order: 0 }], menus: [{ id: 'mn1', moduleId: 'm1', parentId: null, featureKey: 'orders', label: 'Pesanan Lama', icon: 'Receipt', order: 0 }] };
let host: HTMLDivElement; let root: Root;

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  roles = [{ id: 'kasir', name: 'Kasir', isSystem: false }]; failRoles = false; failMenus = false;
  menuData = { modules: [{ id: 'm1', name: 'Operasional', icon: 'Package', order: 0 }], menus: [{ id: 'mn1', moduleId: 'm1', parentId: null, featureKey: 'orders', label: 'Pesanan Lama', icon: 'Receipt', order: 0 }] };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/?]+/, '').split('?')[0];
    calls[path] = (calls[path] ?? 0) + 1;
    if (path === '/api/roles' && failRoles && calls[path] > 1) return { ok: false, status: 500, json: async () => ({}) };
    if (path === '/api/menus' && failMenus && calls[path] > 1) return { ok: false, status: 500, json: async () => ({}) };
    const body = path === '/api/roles' ? { roles } : path === '/api/role-permissions' ? { rolePermissions: {} } : path === '/api/menus' ? menuData : {};
    return { ok: true, status: 200, json: async () => body };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function Other() { const bump = useBumpData(); return <><button id="other" onClick={() => bump('roles', 'roles-tab')}>b</button><button id="menus" onClick={() => bump('menus', 'menus-tab')}>m</button></>; }
const ui = (enabled: boolean): ReactNode => (
  <ToastProvider><DataSyncProvider enabled={enabled}><Other /><RolePermissionsTab creds="x" can={() => true} /></DataSyncProvider></ToastProvider>
);
const render = (n: ReactNode) => act(async () => { root.render(n); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

describe('RolePermissionsTab: daftar role menyegar saat Role berubah di jendela lain', () => {
  it('bump roles: daftar role dimuat ulang sekali, senyap; role baru muncul; izin/role terpilih tidak tersentuh', async () => {
    await render(ui(true)); await settle();
    expect(calls['/api/roles']).toBe(1);
    expect(document.body.textContent).toContain('Kasir');
    roles = [...roles, { id: 'gudang', name: 'Petugas Gudang', isSystem: false }];
    await click(document.getElementById('other')); await settle();
    expect(calls['/api/roles']).toBe(2);
    expect(calls['/api/role-permissions']).toBe(1);        // tidak memuat ulang izin (form tidak ditimpa)
    expect(document.body.textContent).toContain('Petugas Gudang');
  });
  it('server gagal sesaat: daftar lama dipertahankan', async () => {
    await render(ui(true)); await settle();
    failRoles = true;
    await click(document.getElementById('other')); await settle();
    expect(calls['/api/roles']).toBe(2);
    expect(document.body.textContent).toContain('Kasir');
  });
  it('Klasik (enabled=false): bump tidak memicu fetch', async () => {
    await render(ui(false)); await settle();
    await click(document.getElementById('other')); await settle();
    expect(calls['/api/roles']).toBe(1);
  });
});

describe('RolePermissionsTab: daftar modul/menu menyegar saat Modul/Menu berubah di jendela lain', () => {
  it('bump menus: hanya /api/menus dimuat ulang sekali, senyap; label baru tampil; matriks yang sedang diedit tidak berubah', async () => {
    await render(ui(true)); await settle();
    expect(calls['/api/menus']).toBe(1);
    expect(document.body.textContent).toContain('Pesanan Lama');
    // edit matriks (belum disimpan): centang satu izin pada baris Pesanan
    const checks = () => document.querySelectorAll('svg.lucide-check').length;
    const rowEl = Array.from(document.querySelectorAll('div')).find(d => d.className.includes('px-4 py-2.5') && d.textContent?.includes('Pesanan Lama'))!;
    const c0 = checks();
    await click(rowEl.querySelectorAll('button')[1]);
    const checkedBefore = checks();
    expect(checkedBefore).not.toBe(c0);                     // memang ada perubahan yang belum disimpan
    menuData = { modules: menuData.modules, menus: [{ ...menuData.menus[0], label: 'Pesanan Baru' }] };
    await click(document.getElementById('menus')); await settle();
    expect(calls['/api/menus']).toBe(2);
    expect(calls['/api/role-permissions']).toBe(1);          // izin tidak dimuat ulang
    expect(calls['/api/roles']).toBe(1);
    expect(document.body.textContent).toContain('Pesanan Baru');
    expect(checks()).toBe(checkedBefore);                    // perubahan yang belum disimpan tidak tertimpa
  });
  it('menu dihapus dari struktur: halaman tidak crash dan izin tetap tampil sebagai baris cadangan', async () => {
    await render(ui(true)); await settle();
    menuData = { modules: menuData.modules, menus: [] };
    await click(document.getElementById('menus')); await settle();
    expect(calls['/api/menus']).toBe(2);
    expect(document.body.textContent).toContain('Kasir');     // tab tetap hidup
    expect(document.body.textContent).not.toContain('Pesanan Lama');
  });
  it('server gagal sesaat: modul/menu lama dipertahankan', async () => {
    await render(ui(true)); await settle();
    failMenus = true;
    await click(document.getElementById('menus')); await settle();
    expect(calls['/api/menus']).toBe(2);
    expect(document.body.textContent).toContain('Pesanan Lama');
  });
  it('Klasik (enabled=false): bump menus tidak memicu fetch', async () => {
    await render(ui(false)); await settle();
    await click(document.getElementById('menus')); await settle();
    expect(calls['/api/menus']).toBe(1);
  });
});

describe('RolePermissionsTab: role terpilih dihapus di jendela lain', () => {
  it('pilihan dipindahkan ke role non-sistem pertama dengan toast; tombol Simpan tetap aktif untuk role yang ada', async () => {
    roles = [{ id: 'kasir', name: 'Kasir', isSystem: false }, { id: 'gudang', name: 'Petugas Gudang', isSystem: false }];
    await render(ui(true)); await settle();
    roles = roles.filter(r => r.id !== 'kasir');
    await click(document.getElementById('other')); await settle();
    expect(document.body.textContent).toContain('Role yang dipilih dihapus, pilihan dipindahkan.');
    const save = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Simpan Hak Akses')) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });
  it('role yang dihapus BUKAN yang dipilih: tidak ada toast pemindahan dan pilihan tetap', async () => {
    roles = [{ id: 'kasir', name: 'Kasir', isSystem: false }, { id: 'gudang', name: 'Petugas Gudang', isSystem: false }];
    await render(ui(true)); await settle();
    roles = roles.filter(r => r.id !== 'gudang');
    await click(document.getElementById('other')); await settle();
    expect(document.body.textContent).not.toContain('pilihan dipindahkan');
  });
  it('semua role habis: tombol Simpan nonaktif (tidak mengirim ke role hantu)', async () => {
    await render(ui(true)); await settle();
    roles = [];
    await click(document.getElementById('other')); await settle();
    const save = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Simpan Hak Akses')) as HTMLButtonElement | undefined;
    if (save) expect(save.disabled).toBe(true);
  });
});
