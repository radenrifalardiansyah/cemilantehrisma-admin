// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const instances: { stop: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; isScanning: boolean; resolveStart: () => void }[] = [];
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    static getCameras = async () => [{ id: 'cam1', label: 'back camera' }];
    isScanning = false;
    stop = vi.fn(async () => { this.isScanning = false; });
    clear = vi.fn();
    resolveStart: () => void = () => {};
    constructor() { instances.push(this as never); }
    start() { return new Promise<void>(res => { this.resolveStart = () => { this.isScanning = true; res(); }; }); }
    getRunningTrackCameraCapabilities() { throw new Error('tidak ada'); }
    getRunningTrackCapabilities() { return {}; }
    applyVideoConstraints() { return Promise.resolve(); }
  },
}));

import BarcodeScannerModal from './BarcodeScannerModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  instances.length = 0;
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { host.remove(); document.body.innerHTML = ''; });
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });

describe('BarcodeScannerModal: pelepasan kamera', () => {
  it('unmount saat start belum selesai: setelah start resolve, instance itu dihentikan dan dilepas', async () => {
    await act(async () => { root.render(<BarcodeScannerModal onDetect={() => undefined} onClose={() => {}} />); });
    await tick();
    expect(instances).toHaveLength(1);
    act(() => root.unmount());
    await tick();
    await act(async () => { instances[0].resolveStart(); await new Promise(r => setTimeout(r, 20)); });
    expect(instances[0].stop).toHaveBeenCalledTimes(1);
    expect(instances[0].clear).toHaveBeenCalled();
  });

  it('unmount normal (scanner sudah jalan): stop tepat sekali', async () => {
    await act(async () => { root.render(<BarcodeScannerModal onDetect={() => undefined} onClose={() => {}} />); });
    await tick();
    await act(async () => { instances[0].resolveStart(); await new Promise(r => setTimeout(r, 20)); });
    act(() => root.unmount());
    await tick();
    expect(instances[0].stop).toHaveBeenCalledTimes(1);
  });
});
