// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import { readCachedPins } from './pins';
import { usePins } from './use-pins';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof usePins>;
function Probe() { const v = usePins('tok'); useEffect(() => { api = v; }); return null; }

let host: HTMLDivElement; let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<ToastProvider><Probe /></ToastProvider>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const deferred = () => { let resolve!: (v: { ok: boolean; status: number }) => void; const p = new Promise<{ ok: boolean; status: number }>(r => { resolve = r; }); return { p, resolve }; };
const sent = (i: number) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string).pins as string[] | null;

describe('usePins: PUT diserialisasi (dua toggle cepat)', () => {
  it('toggle kedua menunggu PUT pertama selesai, lalu mengirim state terbaru', async () => {
    act(() => api.hydrate('u', ['orders']));
    const d1 = deferred();
    fetchMock.mockReturnValueOnce(d1.p);
    await act(async () => { api.toggle('users'); });
    await act(async () => { api.toggle('dashboard'); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0)).toEqual(['orders', 'users']);
    await act(async () => { d1.resolve({ ok: true, status: 200 }); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1)).toEqual(['orders', 'users', 'dashboard']);
    expect(api.pins).toEqual(['orders', 'users', 'dashboard']);
    expect(readCachedPins('u')).toEqual(['orders', 'users', 'dashboard']);
  });

  it('PUT kedua gagal sebelum yang pertama sukses (urutan balik): akhirnya layar = server (terkonfirmasi), tanpa menyimpang', async () => {
    act(() => api.hydrate('u', ['orders']));
    const d1 = deferred(); const d2 = deferred();
    fetchMock.mockReturnValueOnce(d1.p).mockReturnValueOnce(d2.p);
    await act(async () => { api.toggle('users'); });
    await act(async () => { api.toggle('dashboard'); });
    await act(async () => { d2.resolve({ ok: false, status: 500 }); });
    await act(async () => { d1.resolve({ ok: true, status: 200 }); });
    expect(readCachedPins('u')).toEqual(['orders', 'users']);
    expect(api.pins).toEqual(['orders', 'users']);
  });

  it('gagal saat ada toggle menunggu: tidak rollback, toggle menunggu terkirim', async () => {
    act(() => api.hydrate('u', ['orders']));
    const d1 = deferred();
    fetchMock.mockReturnValueOnce(d1.p);
    await act(async () => { api.toggle('users'); });
    await act(async () => { api.toggle('orders'); });
    await act(async () => { d1.resolve({ ok: false, status: 500 }); });
    expect(sent(1)).toEqual(['users']);
    expect(api.pins).toEqual(['users']);
  });
});
