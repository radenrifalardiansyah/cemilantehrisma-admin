// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import { DEFAULT_PINS, readCachedPins } from './pins';
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
const body = (i = 0) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string) as { pins: string[] | null };
const deferred = () => { let resolve!: (v: { ok: boolean; status: number }) => void; const p = new Promise<{ ok: boolean; status: number }>(r => { resolve = r; }); return { p, resolve }; };

describe('usePins', () => {
  it('hydrate: server menang dan mengisi cache; tanpa server pakai cache; tanpa keduanya bawaan (pins null)', () => {
    act(() => api.hydrate('u', ['orders', 'users']));
    expect(api.pins).toEqual(['orders', 'users']); expect(api.effective).toEqual(['orders', 'users']);
    expect(readCachedPins('u')).toEqual(['orders', 'users']);
    act(() => api.hydrate('u', null));
    expect(api.pins).toEqual(['orders', 'users']);                       // dari cache
    act(() => api.hydrate('lain', null));
    expect(api.pins).toBeNull(); expect(api.effective).toEqual(DEFAULT_PINS);
  });

  it('toggle pertama dimulai dari bawaan (daftar eksplisit), optimistis, PUT body benar, cache terisi', async () => {
    act(() => api.hydrate('u', null));
    await act(async () => { api.toggle('users'); });
    expect(api.pins).toEqual([...DEFAULT_PINS, 'users']);
    expect(body()).toEqual({ pins: [...DEFAULT_PINS, 'users'] });
    expect(readCachedPins('u')).toEqual([...DEFAULT_PINS, 'users']);
  });

  it('lepas lalu sematkan lagi: urutan = urutan disematkan', async () => {
    act(() => api.hydrate('u', ['orders', 'dashboard']));
    await act(async () => { api.toggle('orders'); });
    await act(async () => { api.toggle('orders'); });
    expect(api.pins).toEqual(['dashboard', 'orders']);
  });

  it('gagal: kembali ke nilai terkonfirmasi, cache tidak berubah', async () => {
    act(() => api.hydrate('u', ['orders']));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await act(async () => { api.toggle('users'); });
    expect(api.pins).toEqual(['orders']);
    expect(readCachedPins('u')).toEqual(['orders']);
  });

  it('id yang tidak bisa disematkan diabaikan tanpa request', async () => {
    act(() => api.hydrate('u', ['orders']));
    await act(async () => { api.toggle('bukan-tab'); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('simpan beruntun diserialisasi: yang kedua menunggu yang pertama, cache akhir = state terbaru (tanpa sukses usang menimpa)', async () => {
    act(() => api.hydrate('u', []));
    const first = deferred();
    fetchMock.mockImplementationOnce(() => first.p);
    act(() => { api.toggle('orders'); });                                // simpan pertama tertahan
    await act(async () => { api.toggle('users'); });                     // kedua menunggu giliran (tidak dikirim bersamaan)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCachedPins('u')).toEqual([]);
    await act(async () => { first.resolve({ ok: true, status: 200 }); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body(1)).toEqual({ pins: ['orders', 'users'] });
    expect(readCachedPins('u')).toEqual(['orders', 'users']);
    expect(api.pins).toEqual(['orders', 'users']);
  });

  it('reset: kirim null dan kembali ke bawaan', async () => {
    act(() => api.hydrate('u', ['orders']));
    await act(async () => { api.reset(); });
    expect(body()).toEqual({ pins: null });
    expect(api.pins).toBeNull();
  });
  it('simpan A sukses usang lalu simpan B gagal: rollback harus ke keadaan server (A), bukan sebelum A', async () => {
    act(() => api.hydrate('u', ['orders']));
    const first = deferred(); const second = deferred();
    fetchMock.mockImplementationOnce(() => first.p).mockImplementationOnce(() => second.p);
    act(() => { api.toggle('users'); });                                  // A: ['orders','users']
    act(() => { api.toggle('income'); });                                 // B: ['orders','users','income']
    await act(async () => { first.resolve({ ok: true, status: 200 }); await Promise.resolve(); });   // server kini = A
    await act(async () => { second.resolve({ ok: false, status: 500 }); await Promise.resolve(); }); // B gagal
    expect(api.pins).toEqual(['orders', 'users']);
  });
});
