// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import { DEFAULT_APPEARANCE, readCachedAppearance, readLastAppearance, type Appearance } from './appearance';
import { useAppearance } from './use-appearance';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useAppearance>;
let api: Api;
function Probe() { const v = useAppearance('tok'); useEffect(() => { api = v; }); return null; }

const BLUE: Appearance = { ...DEFAULT_APPEARANCE, accent: 'blue' };
const ROSE: Appearance = { ...DEFAULT_APPEARANCE, accent: 'rose' };

let host: HTMLDivElement; let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<ToastProvider><Probe /></ToastProvider> as ReactNode));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const deferred = () => { let resolve!: (v: { ok: boolean; status: number }) => void; const p = new Promise<{ ok: boolean; status: number }>(r => { resolve = r; }); return { p, resolve }; };

describe('useAppearance', () => {
  it('hydrate: server menang dan mengisi cache; tanpa server pakai cache; tanpa keduanya default', () => {
    act(() => api.hydrate('u', BLUE));
    expect(api.saved).toEqual(BLUE); expect(api.draft).toEqual(BLUE);
    expect(readCachedAppearance('u')).toEqual(BLUE);
    act(() => api.hydrate('u', null));
    expect(api.saved).toEqual(BLUE);                       // dari cache
    act(() => api.hydrate('lain', null));
    expect(api.saved).toEqual(DEFAULT_APPEARANCE);
    expect(readLastAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it('preview hanya mengubah draft (tanpa fetch); cancel mengembalikan ke saved; dirty mengikuti', () => {
    act(() => api.hydrate('u', null));
    act(() => api.preview({ accent: 'teal' }));
    expect(api.draft.accent).toBe('teal'); expect(api.saved.accent).toBe('brand'); expect(api.dirty).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => api.cancel());
    expect(api.draft).toEqual(DEFAULT_APPEARANCE); expect(api.dirty).toBe(false);
  });

  it('reset mengisi draft dengan default tanpa menyimpan', () => {
    act(() => api.hydrate('u', BLUE));
    act(() => api.reset());
    expect(api.draft).toEqual(DEFAULT_APPEARANCE); expect(api.saved).toEqual(BLUE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('save sukses: PUT body {appearance}, saved diperbarui, cache terisi', async () => {
    act(() => api.hydrate('u', null));
    act(() => api.preview({ accent: 'blue' }));
    let ok = false;
    await act(async () => { ok = await api.save(); });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/me/appearance');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ appearance: BLUE });
    expect(api.saved).toEqual(BLUE); expect(api.busy).toBe(false);
    expect(readCachedAppearance('u')).toEqual(BLUE);
  });

  it('save gagal: kembali ke nilai sebelumnya, cache tidak berubah', async () => {
    act(() => api.hydrate('u', BLUE));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    act(() => api.preview({ accent: 'rose' }));
    let ok = true;
    await act(async () => { ok = await api.save(); });
    expect(ok).toBe(false);
    expect(api.saved).toEqual(BLUE); expect(api.draft).toEqual(BLUE);
    expect(readCachedAppearance('u')).toEqual(BLUE);
  });

  it('tanpa perubahan: save tidak mengirim request', async () => {
    act(() => api.hydrate('u', BLUE));
    await act(async () => { await api.save(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sukses usang (simpan lama selesai belakangan) tidak menimpa nilai terkonfirmasi maupun cache', async () => {
    act(() => api.hydrate('u', null));
    const first = deferred();
    fetchMock.mockImplementationOnce(() => first.p);
    act(() => api.preview({ accent: 'blue' }));
    let p1!: Promise<boolean>;
    act(() => { p1 = api.save(); });
    act(() => api.preview({ accent: 'rose' }));
    await act(async () => { await api.save(); });            // simpan kedua (rose) selesai lebih dulu
    expect(readCachedAppearance('u')).toEqual(ROSE);
    await act(async () => { first.resolve({ ok: true, status: 200 }); await p1; });
    expect(readCachedAppearance('u')).toEqual(ROSE);         // tidak ditimpa blue
    expect(api.saved).toEqual(ROSE);
  });
  it('jaringan gagal (fetch melempar): rollback ke nilai terkonfirmasi, busy kembali false, cache tidak berubah', async () => {
    act(() => api.hydrate('u', BLUE));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => api.preview({ accent: 'rose' }));
    let ok = true;
    await act(async () => { ok = await api.save(); });
    expect(ok).toBe(false);
    expect(api.saved).toEqual(BLUE); expect(api.draft).toEqual(BLUE); expect(api.busy).toBe(false);
    expect(readCachedAppearance('u')).toEqual(BLUE);
  });

  it('timeout 15 detik: request dibatalkan (abort), rollback, busy false, simpan berikutnya bisa dicoba lagi', async () => {
    vi.useFakeTimers();
    try {
      act(() => api.hydrate('u', BLUE));
      let signal!: AbortSignal;
      fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_res, rej) => {
        signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      }));
      act(() => api.preview({ accent: 'rose' }));
      let p!: Promise<boolean>;
      act(() => { p = api.save(); });
      expect(api.busy).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
      expect(signal.aborted).toBe(false);
      let ok = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(2); ok = await p; });
      expect(signal.aborted).toBe(true);
      expect(ok).toBe(false);
      expect(api.busy).toBe(false);
      expect(api.saved).toEqual(BLUE); expect(api.draft).toEqual(BLUE);
      // percobaan ulang: pratinjau lagi lalu simpan sukses
      act(() => api.preview({ accent: 'rose' }));
      await act(async () => { ok = await api.save(); });
      expect(ok).toBe(true);
      expect(readCachedAppearance('u')).toEqual(ROSE);
    } finally { vi.useRealTimers(); }
  });

  it('hydrate pengguna lain tidak membawa cache/draft pengguna sebelumnya; cache per username tidak saling menimpa', async () => {
    act(() => api.hydrate('a', BLUE));
    act(() => api.hydrate('b', ROSE));
    expect(readCachedAppearance('a')).toEqual(BLUE);
    expect(readCachedAppearance('b')).toEqual(ROSE);
    act(() => api.hydrate('c', null));
    expect(api.saved).toEqual(DEFAULT_APPEARANCE); expect(api.draft).toEqual(DEFAULT_APPEARANCE);
    // simpan oleh 'c' hanya menulis cache 'c'
    act(() => api.preview({ accent: 'teal' }));
    await act(async () => { await api.save(); });
    expect(readCachedAppearance('a')).toEqual(BLUE);
    expect(readCachedAppearance('b')).toEqual(ROSE);
    expect(readCachedAppearance('c')?.accent).toBe('teal');
  });
});
