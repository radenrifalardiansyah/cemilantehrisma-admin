// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import { readCachedWidgets, type WidgetInstance } from './widgets';
import { CONFIG_DEBOUNCE_MS, useWidgets } from './use-widgets';
import { addWidget, moveWidget, resizeWidget } from './widget-layout';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useWidgets>;
function Probe() { const v = useWidgets('tok'); useEffect(() => { api = v; }); return null; }

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
const body = (i = 0) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string) as { widgets: WidgetInstance[] | null };
const deferred = () => { let resolve!: (v: { ok: boolean; status: number }) => void; const p = new Promise<{ ok: boolean; status: number }>(r => { resolve = r; }); return { p, resolve }; };

describe('useWidgets', () => {
  it('hydrate: server menang dan mengisi cache; tanpa server pakai cache; tanpa keduanya kosong (raw null)', () => {
    act(() => api.hydrate('u', [clock]));
    expect(api.widgets).toEqual([clock]);
    expect(readCachedWidgets('u')).toEqual([clock]);
    act(() => api.hydrate('u', null));
    expect(api.widgets).toEqual([clock]);                                 // dari cache
    act(() => api.hydrate('lain', null));
    expect(api.widgets).toEqual([]); expect(api.raw).toBeNull();
    act(() => api.hydrate('lain', []));
    expect(api.raw).toEqual([]);                                          // [] dibedakan dari null
  });

  it('tambah: optimistis, PUT body benar, cache terisi saat terkonfirmasi', async () => {
    act(() => api.hydrate('u', null));
    let ok = false;
    await act(async () => { ok = api.apply(cur => { const r = addWidget(cur, 'clock', 10, 5, 'new00001'); return r.ok ? r.widgets : null; }); });
    expect(ok).toBe(true);
    expect(api.widgets).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/me/widgets');
    expect(body().widgets![0]).toMatchObject({ id: 'new00001', type: 'clock', col: 0, row: 0, size: 's' });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-admin-auth': 'tok' });
    expect(readCachedWidgets('u')).toHaveLength(1);
  });

  it('mutator menolak (null): tidak ada PUT, apply false', async () => {
    act(() => api.hydrate('u', [clock]));
    let ok = true;
    await act(async () => { ok = api.apply(() => null); });
    expect(ok).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tidak ada perubahan (sama persis): tidak ada PUT', async () => {
    act(() => api.hydrate('u', [clock, note]));
    await act(async () => { api.apply(cur => moveWidget(cur, clock.id, 0, 0, 10, 5).widgets); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pindah dan ubah ukuran dan hapus', async () => {
    act(() => api.hydrate('u', [clock, note]));
    await act(async () => { api.apply(cur => { const r = moveWidget(cur, clock.id, 6, 2, 10, 5); return r.ok ? r.widgets : null; }); });
    expect(api.widgets[0]).toMatchObject({ col: 6, row: 2 });
    await act(async () => { api.apply(cur => { const r = resizeWidget(cur, clock.id, 'm', 10, 5); return r.ok ? r.widgets : null; }); });
    expect(api.widgets[0].size).toBe('m');
    await act(async () => { api.apply(cur => cur.filter(w => w.id !== note.id)); });
    expect(api.widgets.map(w => w.id)).toEqual([clock.id]);
    expect(body(2).widgets).toHaveLength(1);
  });

  it('hapus semua menyimpan [] (bukan null)', async () => {
    act(() => api.hydrate('u', [clock]));
    await act(async () => { api.apply(() => []); });
    expect(body().widgets).toEqual([]); expect(api.raw).toEqual([]);
  });

  it('gagal: kembali ke nilai terkonfirmasi, cache tidak berubah', async () => {
    act(() => api.hydrate('u', [clock]));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await act(async () => { api.apply(() => []); });
    expect(api.widgets).toEqual([clock]);
    expect(readCachedWidgets('u')).toEqual([clock]);
  });

  it('sukses usang tidak menimpa; rollback ke keadaan terkonfirmasi yang benar', async () => {
    act(() => api.hydrate('u', [clock]));
    const d1 = deferred(); const d2 = deferred();
    fetchMock.mockReturnValueOnce(d1.p).mockReturnValueOnce(d2.p);
    await act(async () => { api.apply(() => [clock, note]); });                         // PUT #1 (tertunda)
    await act(async () => { api.apply(() => [note]); });                                // PUT #2 (tertunda)
    await act(async () => { d2.resolve({ ok: true, status: 200 }); });                  // #2 sukses dulu -> terkonfirmasi [note]
    await act(async () => { d1.resolve({ ok: true, status: 200 }); });                  // #1 usang: tidak menimpa
    expect(readCachedWidgets('u')).toEqual([note]);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await act(async () => { api.apply(() => []); });                                    // #3 gagal -> kembali ke [note], bukan [clock]
    expect(api.widgets).toEqual([note]);
  });

  describe('config (debounce)', () => {
    it('state langsung berubah; PUT hanya sekali setelah jeda; ketikan beruntun digabung', async () => {
      act(() => api.hydrate('u', [note]));
      act(() => api.setConfig(note.id, { text: 'a' }));
      expect(api.widgets[0].config).toEqual({ text: 'a' });
      act(() => { vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS - 100); });
      act(() => api.setConfig(note.id, { text: 'ab' }));
      act(() => { vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS - 100); });
      expect(fetchMock).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(200); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body().widgets![0].config).toEqual({ text: 'ab' });
    });

    it('flush manual dan saat unmount menyimpan ketikan tertunda', async () => {
      act(() => api.hydrate('u', [note]));
      act(() => api.setConfig(note.id, { text: 'x' }));
      await act(async () => { api.flush(); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      act(() => api.setConfig(note.id, { text: 'xy' }));
      act(() => root.unmount());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(body(1).widgets![0].config).toEqual({ text: 'xy' });
      root = createRoot(host);                                                          // afterEach akan unmount root ini
      act(() => root.render(<ToastProvider><Probe /></ToastProvider>));
    });

    it('pagehide menyimpan ketikan tertunda', async () => {
      act(() => api.hydrate('u', [note]));
      act(() => api.setConfig(note.id, { text: 'q' }));
      await act(async () => { window.dispatchEvent(new Event('pagehide')); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('perubahan struktur membawa config terbaru dan membatalkan timer (satu PUT)', async () => {
      act(() => api.hydrate('u', [clock, note]));
      act(() => api.setConfig(note.id, { text: 'catatan' }));
      await act(async () => { api.apply(cur => cur.filter(w => w.id !== clock.id)); });
      expect(body().widgets).toEqual([{ ...note, config: { text: 'catatan' } }]);
      await act(async () => { vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS * 2); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('respons lama tidak menimpa ketikan; kegagalan saat ada ketikan tertunda tidak me-rollback ketikan', async () => {
      act(() => api.hydrate('u', [note]));
      const d1 = deferred();
      fetchMock.mockReturnValueOnce(d1.p);
      await act(async () => { api.apply(cur => cur.map(w => ({ ...w, col: 5 }))); });   // PUT tertunda
      act(() => api.setConfig(note.id, { text: 'sedang mengetik' }));
      await act(async () => { d1.resolve({ ok: false, status: 500 }); });
      expect(api.widgets[0].config).toEqual({ text: 'sedang mengetik' });                // tidak di-rollback
      await act(async () => { vi.advanceTimersByTime(CONFIG_DEBOUNCE_MS + 10); });
      expect(body(1).widgets![0]).toMatchObject({ col: 5, config: { text: 'sedang mengetik' } });
    });

    it('setConfig untuk id yang tidak ada diabaikan; hydrate diabaikan selama ketikan tertunda', async () => {
      act(() => api.hydrate('u', [note]));
      act(() => api.setConfig('tidak-ada', { text: 'x' }));
      expect(fetchMock).not.toHaveBeenCalled();
      act(() => api.setConfig(note.id, { text: 'draf' }));
      act(() => api.hydrate('u', [{ ...note, config: { text: 'dari server' } }]));
      expect(api.widgets[0].config).toEqual({ text: 'draf' });
    });
  });
});
