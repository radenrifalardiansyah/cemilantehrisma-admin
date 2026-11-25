// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import { DataSyncProvider, useBumpData } from '@/lib/data-sync';
import RolePermissionsTab from './RolePermissionsTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mode jendela: role yang sedang dipilih di Izin Role dihapus di jendela Role. Daftar role disegarkan senyap, tetapi
// selectedRoleId lama dipertahankan -> matriks role yang sudah tidak ada tetap bisa disimpan (PUT ke role hantu).

const puts: string[] = [];
let roles = [{ id: 'kasir', name: 'Kasir', isSystem: false }, { id: 'gudang', name: 'Petugas Gudang', isSystem: false }];
let host: HTMLDivElement; let root: Root;

beforeEach(() => {
  puts.length = 0;
  roles = [{ id: 'kasir', name: 'Kasir', isSystem: false }, { id: 'gudang', name: 'Petugas Gudang', isSystem: false }];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/?]+/, '').split('?')[0];
    if (init?.method === 'PUT') { puts.push(path); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    const body = path === '/api/roles' ? { roles } : path === '/api/role-permissions' ? { rolePermissions: {} } : path === '/api/menus' ? { modules: [], menus: [] } : {};
    return { ok: true, status: 200, json: async () => body };
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function Other() { const bump = useBumpData(); return <button id="roles" onClick={() => bump('roles', 'roles-tab')}>b</button>; }
const ui = (): ReactNode => (
  <ToastProvider><DataSyncProvider enabled><Other /><RolePermissionsTab creds="x" can={() => true} /></DataSyncProvider></ToastProvider>
);
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });

describe('RolePermissionsTab: role terpilih dihapus di jendela lain', () => {
  it('menyimpan matriks untuk role yang sudah dihapus tidak boleh mengirim PUT ke role hantu', async () => {
    await act(async () => { root.render(ui()); }); await settle();
    // role terpilih awal = role non-sistem pertama ('kasir'); hapus di jendela Role lalu segarkan
    roles = roles.filter(r => r.id !== 'kasir');
    await click(document.getElementById('roles')); await settle();
    expect(Array.from(document.querySelectorAll('button')).map(b => b.textContent)).not.toContain('Kasir');
    const save = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Simpan Hak Akses'));
    if (save) await click(save);
    await settle();
    expect(puts, 'PUT ke role yang sudah tidak ada').not.toContain('/api/role-permissions/kasir');
  });
});
