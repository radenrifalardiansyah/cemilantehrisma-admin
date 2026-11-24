// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readCachedLayout, type UiLayout } from '@/lib/ui-layout';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toastError = vi.fn();
vi.mock('@/components/Toast', () => ({ useToast: () => ({ error: toastError, success: vi.fn() }) }));

import { useUiLayout } from './use-ui-layout';

type Api = ReturnType<typeof useUiLayout>;
let api: Api;
let root: Root;
let host: HTMLElement;
function Probe() {
  const v = useUiLayout('tok');
  useEffect(() => { api = v; });
  return null;
}

// Setiap fetch menunggu diselesaikan manual (urutan respons bisa diatur).
type Pending = { body: string; resolve: (ok: boolean) => void; signal: AbortSignal };
let pending: Pending[];

beforeEach(() => {
  localStorage.clear(); toastError.mockClear(); pending = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((res, rej) => {
    const signal = init.signal as AbortSignal;
    signal.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError')));
    pending.push({ body: String(init.body), signal, resolve: ok => res({ ok, status: ok ? 200 : 500 }) });
  })));
  host = document.createElement('div'); root = createRoot(host);
  act(() => { root.render(<Probe />); });
  act(() => { api.hydrate('rifal', 'classic'); });
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

const settle = async (i: number, ok: boolean) => { await act(async () => { pending[i].resolve(ok); await Promise.resolve(); }); };

describe('useUiLayout', () => {
  it('berlaku langsung (optimistis), tersimpan ke cache saat server menyetujui', async () => {
    let p!: Promise<void>;
    act(() => { p = api.change('mac'); });
    expect(api.layout).toBe('mac'); expect(api.busy).toBe(true);
    await settle(0, true); await act(async () => { await p; });
    expect(api.busy).toBe(false); expect(readCachedLayout('rifal')).toBe('mac');
  });

  it('gagal: kembali ke nilai terkonfirmasi + toast; cache tidak berubah', async () => {
    let p!: Promise<void>;
    act(() => { p = api.change('windows'); });
    await settle(0, false); await act(async () => { await p; });
    expect(api.layout).toBe('classic'); expect(toastError).toHaveBeenCalledTimes(1);
    expect(readCachedLayout('rifal')).toBe('classic');
  });

  it('timeout 15 dtk membatalkan request dan mengembalikan layout', async () => {
    vi.useFakeTimers();
    let p!: Promise<void>;
    act(() => { p = api.change('mac'); });
    await act(async () => { vi.advanceTimersByTime(15_001); await p; });
    expect(pending[0].signal.aborted).toBe(true);
    expect(api.layout).toBe('classic'); expect(api.busy).toBe(false);
  });

  it('dua perubahan beruntun, respons lama tiba terlambat: tampilan, cache, dan nilai terkonfirmasi harus konsisten dengan pilihan TERAKHIR', async () => {
    let p1!: Promise<void>, p2!: Promise<void>;
    act(() => { p1 = api.change('windows'); });
    act(() => { p2 = api.change('mac'); });
    // 'mac' (terakhir) sukses lebih dulu, lalu respons 'windows' yang lama tiba
    await settle(1, true); await act(async () => { await p2; });
    await settle(0, true); await act(async () => { await p1; });
    expect(api.layout).toBe('mac');
    expect(readCachedLayout('rifal')).toBe('mac'); // cache jangan ditimpa respons usang
  });

  it('pilihan terakhir gagal setelah pilihan sebelumnya sukses terlambat: tampilan tidak boleh berbeda dari cache', async () => {
    let p1!: Promise<void>, p2!: Promise<void>;
    act(() => { p1 = api.change('windows'); });
    act(() => { p2 = api.change('mac'); });
    await settle(1, false); await act(async () => { await p2; });   // mac gagal -> rollback
    await settle(0, true); await act(async () => { await p1; });    // windows sukses (server menyimpan windows)
    const shown: UiLayout = api.layout;
    expect(readCachedLayout('rifal')).toBe(shown);
  });
});
