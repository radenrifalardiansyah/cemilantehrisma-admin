// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFullscreen } from './use-fullscreen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useFullscreen>;
let api: Api;
let errors: unknown[];
function Probe() { const v = useFullscreen(e => errors.push(e)); useEffect(() => { api = v; }); return null; }

const d = document as unknown as Record<string, unknown>;
let fsEl: Element | null;
let request: ReturnType<typeof vi.fn>; let exit: ReturnType<typeof vi.fn>;
let host: HTMLDivElement; let root: Root;

function setup(supported: boolean | undefined) {
  fsEl = null; errors = [];
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => supported });
  request = vi.fn(async () => { fsEl = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); });
  exit = vi.fn(async () => { fsEl = null; document.dispatchEvent(new Event('fullscreenchange')); });
  document.documentElement.requestFullscreen = request as unknown as () => Promise<void>;
  d.exitFullscreen = exit;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<Probe />));
}
afterEach(() => { act(() => root.unmount()); host.remove(); delete d.fullscreenElement; delete d.fullscreenEnabled; });

describe('useFullscreen', () => {
  it('didukung: toggle masuk memanggil requestFullscreen dan state ikut berubah; toggle lagi memanggil exitFullscreen', async () => {
    setup(true);
    expect(api.supported).toBe(true); expect(api.isFullscreen).toBe(false);
    await act(async () => { await api.toggle(); });
    expect(request).toHaveBeenCalledTimes(1); expect(api.isFullscreen).toBe(true);
    await act(async () => { await api.toggle(); });
    expect(exit).toHaveBeenCalledTimes(1); expect(api.isFullscreen).toBe(false);
  });

  it('keluar lewat Esc (peramban, tanpa toggle): event fullscreenchange menyinkronkan state', async () => {
    setup(true);
    await act(async () => { await api.toggle(); });
    expect(api.isFullscreen).toBe(true);
    act(() => { fsEl = null; document.dispatchEvent(new Event('fullscreenchange')); });
    expect(api.isFullscreen).toBe(false);
  });

  it('tidak didukung (fullscreenEnabled false/undefined): supported false', () => {
    setup(false); expect(api.supported).toBe(false);
    act(() => root.unmount()); host.remove(); delete d.fullscreenEnabled;
    setup(undefined); expect(api.supported).toBe(false);
  });

  it('request ditolak (izin/bukan gestur): tidak melempar, dilaporkan ke onError, state tetap', async () => {
    setup(true);
    request.mockRejectedValueOnce(new Error('denied'));
    await act(async () => { await api.toggle(); });
    expect(errors).toHaveLength(1); expect(api.isFullscreen).toBe(false);
  });

  it('listener dilepas saat unmount (tidak ada kebocoran)', () => {
    setup(true);
    const rm = vi.spyOn(document, 'removeEventListener');
    act(() => root.unmount());
    expect(rm.mock.calls.some(c => c[0] === 'fullscreenchange')).toBe(true);
    root = createRoot(host);
  });
});
