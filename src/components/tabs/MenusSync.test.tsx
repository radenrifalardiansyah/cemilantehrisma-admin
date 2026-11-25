// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataSyncProvider, useBumpData } from '@/lib/data-sync';

vi.mock('@/lib/pdf/GenericTablePDF', () => ({ default: () => null }));
vi.mock('@react-pdf/renderer', () => ({ pdf: () => ({ toBlob: async () => new Blob() }) }));
vi.mock('exceljs', () => ({ default: { Workbook: class {} } }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/components/Confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/lib/pdf/useStoreHeader', () => ({ useStoreHeader: () => ({}) }));

import ModulesTab from './ModulesTab';
import MenusTab from './MenusTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mod = (id: string, name: string) => ({ id, name, icon: 'Package', order: 0, isActive: true });
let moduleNames = ['Modul Satu'];
let menusOk = true;
let deleteOk = true;
let holdMenus = false;
let releaseMenus: (() => void) | null = null;
const oneMenu = { id: 'mn1', moduleId: 'm1', parentId: null, featureKey: 'orders', label: 'Pesanan', icon: 'Package', order: 0, isActive: true };
const calls: Record<string, number> = {};
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  nav.n = 0;
  moduleNames = ['Modul Satu']; menusOk = true; deleteOk = true; holdMenus = false; releaseMenus = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    calls[key] = (calls[key] ?? 0) + 1;
    const json = (b: unknown, ok = true) => ({ ok, json: async () => b });
    if (path === '/api/menus/mn1' && init?.method === 'DELETE') return json({});
    if (path === '/api/menus?scope=manage' && holdMenus) {   // respons senyap LAMA tertahan, dilepas manual
      holdMenus = false;
      return new Promise(res => { releaseMenus = () => res({ ok: true, json: async () => ({ modules: [mod('m1', 'Modul LAMA')], menus: [oneMenu] }) }); });
    }
    if (path === '/api/modules/m1' && init?.method === 'DELETE') return json({}, deleteOk);
    if (path === '/api/modules') return json({ modules: moduleNames.map((n, i) => mod(`m${i + 1}`, n)) });
    if (path === '/api/menus?scope=manage') return menusOk ? json({ modules: moduleNames.map((n, i) => mod(`m${i + 1}`, n)), menus: [oneMenu] }) : json({ error: 'x' }, false);
    return json({});
  }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function Bumper() { const bump = useBumpData(); return (<>
  <button id="other" onClick={() => bump('menus', 'role-permissions-tab')}>lain</button>
  <button id="self" onClick={() => bump('menus', 'menus-tab')}>sendiri</button>
</>); }
// Meniru page: onChanged -> fetchNav -> state level page berubah -> render ulang induk tanpa remount.
const nav = { n: 0 };
function Host({ enabled }: { enabled: boolean }) {
  const [, setN] = useState(0);
  const onChanged = () => { nav.n++; setN(x => x + 1); };
  return (
    <DataSyncProvider enabled={enabled}>
      <Bumper />
      <div id="mods"><ModulesTab creds="x" can={() => true} onChanged={onChanged} /></div>
      <div id="menus"><MenusTab creds="x" can={() => true} onChanged={onChanged} /></div>
    </DataSyncProvider>
  );
}
const render = (ui: ReactNode) => act(async () => { root.render(ui); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const mkey = 'GET /api/menus?scope=manage';

describe('Modul/Menu: sinkron domain menus', () => {
  it('bump dari jendela lain memuat ulang daftar di Menu sekali, senyap, tanpa loop; bump sendiri dilewati', async () => {
    await render(<Host enabled />); await settle();
    expect(calls[mkey]).toBe(1);
    moduleNames = ['Modul Baru'];
    await click(document.getElementById('other')); await settle();
    expect(calls[mkey]).toBe(2);
    expect(document.getElementById('menus')!.textContent).toContain('Modul Baru');
    await click(document.getElementById('self')); await settle();
    expect(calls[mkey]).toBe(2);
  });

  it('gagal (500): daftar lama dipertahankan', async () => {
    await render(<Host enabled />); await settle();
    menusOk = false;
    await click(document.getElementById('other')); await settle();
    expect(calls[mkey]).toBe(2);
    expect(document.getElementById('menus')!.textContent).toContain('Modul Satu');
  });

  it('Klasik (enabled=false): bump tidak memuat ulang', async () => {
    await render(<Host enabled={false} />); await settle();
    await click(document.getElementById('other')); await settle();
    expect(calls[mkey]).toBe(1);
  });

  it('hapus modul berhasil: Menu menyegar sekali dan onChanged (fetchNav) terpanggil; filter di Modul dan jendela tidak reset (tanpa remount)', async () => {
    await render(<Host enabled />); await settle();
    const search = document.querySelector('#mods input[placeholder^="Cari"]') as HTMLInputElement;
    expect(search).not.toBeNull();
    const del = [...document.querySelectorAll('#mods button')].find(b => b.querySelector('.lucide-trash-2'));
    await click(del ?? null); await settle();
    expect(calls['DELETE /api/modules/m1']).toBe(1);
    expect(nav.n).toBe(1);
    expect(calls[mkey]).toBe(2);
    expect(document.querySelector('#mods input[placeholder^="Cari"]')).toBe(search);   // elemen sama: tidak remount
  });

  it('hapus modul gagal: tidak ada bump dan onChanged tidak terpanggil', async () => {
    deleteOk = false;
    await render(<Host enabled />); await settle();
    const del = [...document.querySelectorAll('#mods button')].find(b => b.querySelector('.lucide-trash-2'));
    await click(del ?? null); await settle();
    expect(calls['DELETE /api/modules/m1']).toBe(1);
    expect(nav.n).toBe(0);
    expect(calls[mkey]).toBe(1);
  });

  it('respons senyap lama yang tiba setelah load(true) baru tidak menimpa data terbaru', async () => {
    await render(<Host enabled />); await settle();
    holdMenus = true;
    await click(document.getElementById('other')); await settle();          // senyap tertahan
    moduleNames = ['Modul BARU'];
    const del = [...document.querySelectorAll('#menus button')].find(b => b.querySelector('.lucide-trash-2'));
    await click(del ?? null); await settle();                               // hapus sendiri -> load(true) segar
    expect(document.getElementById('menus')!.textContent).toContain('Modul BARU');
    await act(async () => { releaseMenus?.(); await new Promise(r => setTimeout(r, 50)); });
    expect(document.getElementById('menus')!.textContent).toContain('Modul BARU');
    expect(document.getElementById('menus')!.textContent).not.toContain('Modul LAMA');
  });
});
