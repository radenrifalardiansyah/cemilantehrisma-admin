// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ToastProvider from '@/components/Toast';
import { readCachedWidgets, type WidgetInstance } from './widgets';
import { useWidgets } from './use-widgets';

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
const deferred = () => { let resolve!: (v: { ok: boolean; status: number }) => void; const p = new Promise<{ ok: boolean; status: number }>(r => { resolve = r; }); return { p, resolve }; };

// Aisha (QA): celah di luar tes use-widgets.test.tsx, yaitu simpan beruntun cepat dengan kegagalan yang datang LEBIH CEPAT daripada sukses sebelumnya.
describe('useWidgets: simpan beruntun dengan hasil tidak berurutan', () => {
  it('PUT #2 gagal sebelum PUT #1 selesai sukses: tampilan akhir harus sama dengan keadaan server/terkonfirmasi (tidak menyimpang)', async () => {
    act(() => api.hydrate('u', [clock]));
    const d1 = deferred(); const d2 = deferred();
    fetchMock.mockReturnValueOnce(d1.p).mockReturnValueOnce(d2.p);
    await act(async () => { api.apply(() => [clock, note]); });                 // #1: tambah catatan (tertunda)
    await act(async () => { api.apply(cur => cur.map(w => (w.id === note.id ? { ...w, col: 5 } : w))); });  // #2: pindah (tertunda)
    await act(async () => { d2.resolve({ ok: false, status: 500 }); });         // #2 gagal dulu -> rollback
    await act(async () => { d1.resolve({ ok: true, status: 200 }); });          // #1 sukses: server kini berisi [clock, note(col 2)]
    const server = readCachedWidgets('u');
    expect(server).toEqual([clock, note]);
    // Yang tampil di layar harus sama dengan yang tersimpan di server; kalau tidak, aksi berikutnya menimpa catatan yang sudah tersimpan.
    expect(api.widgets).toEqual(server);
  });
});
