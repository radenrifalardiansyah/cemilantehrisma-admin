// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import { readCachedWidgets, type WidgetInstance } from './widgets';
import { CONFIG_DEBOUNCE_MS, useWidgets } from './use-widgets';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useWidgets>;
function Probe({ creds = 'tok' }: { creds?: string }) { const v = useWidgets(creds); useEffect(() => { api = v; }); return null; }

const clock: WidgetInstance = { id: 'abcd1234', type: 'clock', col: 0, row: 0, size: 's', config: {} };
const note: WidgetInstance = { id: 'efgh5678', type: 'note', col: 2, row: 0, size: 'm', config: { text: '' } };

let host: HTMLDivElement; let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<ToastProvider><Probe /></ToastProvider>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const deferred = () => { let resolve!: (v: { ok: boolean; status: number }) => void; const p = new Promise<{ ok: boolean; status: number }>(r => { resolve = r; }); return { p, resolve }; };
const sent = (i: number) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string).widgets as WidgetInstance[];

describe('useWidgets: PUT diserialisasi', () => {
  it('hanya satu PUT berjalan; perubahan beruntun digabung dan giliran berikutnya mengirim state TERBARU', async () => {
    act(() => api.hydrate('u', [clock]));
    const d1 = deferred();
    fetchMock.mockReturnValueOnce(d1.p);
    await act(async () => { api.apply(() => [clock, note]); });
    await act(async () => { api.apply(cur => cur.map(w => (w.id === note.id ? { ...w, col: 5 } : w))); });
    await act(async () => { api.apply(cur => cur.map(w => (w.id === note.id ? { ...w, col: 6 } : w))); });
    expect(fetchMock).toHaveBeenCalledTimes(1);                       // yang kedua dan ketiga menunggu
    await act(async () => { d1.resolve({ ok: true, status: 200 }); });
    expect(fetchMock).toHaveBeenCalledTimes(2);                       // digabung menjadi satu PUT
    expect(sent(0)).toEqual([clock, note]);
    expect(sent(1)[1]).toMatchObject({ col: 6 });                     // state terbaru, bukan snapshot #2
    expect(readCachedWidgets('u')![1]).toMatchObject({ col: 6 });
    expect(api.widgets[1]).toMatchObject({ col: 6 });
  });

  it('gagal saat ada perubahan menunggu: tidak rollback; perubahan menunggu tetap terkirim dan jadi acuan', async () => {
    act(() => api.hydrate('u', [clock]));
    const d1 = deferred();
    fetchMock.mockReturnValueOnce(d1.p);
    await act(async () => { api.apply(() => [clock, note]); });
    await act(async () => { api.apply(() => [note]); });
    await act(async () => { d1.resolve({ ok: false, status: 500 }); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1)).toEqual([note]);
    expect(api.widgets).toEqual([note]);
    expect(readCachedWidgets('u')).toEqual([note]);
  });

  it('dua PUT gagal berturut-turut: satu rollback ke keadaan terkonfirmasi dengan satu toast', async () => {
    act(() => api.hydrate('u', [clock]));
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await act(async () => { api.apply(() => [clock, note]); });
    await act(async () => { api.apply(() => [note]); });
    expect(api.widgets).toEqual([clock]);
    expect(readCachedWidgets('u')).toEqual([clock]);
  });
});

describe('useWidgets: hydrate untuk username lain', () => {
  it('ketikan tertunda pengguna lama dikirim dengan kredensial lama lalu timer dibuang; tidak ada PUT liar setelah debounce', async () => {
    act(() => api.hydrate('lama', [note]));
    act(() => api.setConfig(note.id, { text: 'penting' }));
    await act(async () => { api.hydrate('baru', [clock]); });
    await act(async () => { root.render(<ToastProvider><Probe creds="tok-baru" /></ToastProvider>); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-admin-auth': 'tok' });   // kredensial lama
    expect(sent(0)[0].config).toEqual({ text: 'penting' });
    expect(api.widgets).toEqual([clock]);
    await act(async () => { vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS * 3); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bila ada PUT berjalan, ketikan pengguna lama dibuang dan tidak pernah dikirim dengan kredensial baru', async () => {
    act(() => api.hydrate('lama', [note]));
    const d1 = deferred();
    fetchMock.mockReturnValueOnce(d1.p);
    await act(async () => { api.apply(cur => cur.map(w => ({ ...w, col: 4 }))); });
    act(() => api.setConfig(note.id, { text: 'draf' }));
    await act(async () => { api.hydrate('baru', [clock]); });
    await act(async () => { root.render(<ToastProvider><Probe creds="tok-baru" /></ToastProvider>); });
    await act(async () => { d1.resolve({ ok: true, status: 200 }); });
    await act(async () => { vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS * 3); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.widgets).toEqual([clock]);
    expect(readCachedWidgets('lama')).toEqual([note]);    // hasil PUT lama tidak mengotori cache pengguna baru maupun menimpa
    expect(readCachedWidgets('baru')).toEqual([clock]);
  });
});
