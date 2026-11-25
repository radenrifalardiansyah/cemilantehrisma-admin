// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayoutDashboard } from 'lucide-react';
import WindowFrame from './WindowFrame';
import { useWindowManager } from './use-window-manager';
import { geometryKey } from '@/lib/window-geometry';
import { type WmAction } from './window-reducer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Integrasi WindowFrame + useWindowManager (tanpa mock dispatch): geser titlebar sungguhan sampai tepi lalu lepas.
let send: (a: WmAction) => void = () => {};
const item = { tab: 'orders', label: 'Pesanan', Icon: LayoutDashboard, color: '#D4691E', windowed: true, badge: 0 };
function H() {
  const { wm, dispatch } = useWindowManager({ enabled: true, skin: 'windows', activeTab: 'dashboard', username: 'rifal' });
  useEffect(() => { send = dispatch; });
  return <>{wm.windows.map(w => (
    <WindowFrame key={w.tabId} win={w} area={wm.area} item={item} focused zIndex={1} onFocus={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}}
      onMove={(x, y) => dispatch({ type: 'move', tabId: w.tabId, x, y })} onResize={r => dispatch({ type: 'resize', tabId: w.tabId, ...r })} dispatch={dispatch}>isi</WindowFrame>
  ))}</>;
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); });
const fire = (el: Element, type: string, x: number, y: number) =>
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
const frame = async (ms = 40) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
const stored = () => JSON.parse(localStorage.getItem(geometryKey('rifal', 'windows')) || 'null') as Record<string, { x: number; y: number; w: number; h: number }> | null;

describe('WindowFrame + useWindowManager: tempel ke tepi lewat geser', () => {
  it('geser ke tepi kiri lalu lepas menyimpan rect SEBELUM digeser (bukan posisi di tepi layar) sebagai rect normal', async () => {
    await act(async () => { root.render(<H />); });
    await act(async () => { send({ type: 'open', tabId: 'orders', rect: { x: 300, y: 150, w: 800, h: 500 } }); });
    const tb = document.querySelector('.dsk-tb')!;
    fire(tb, 'pointerdown', 500, 160);
    fire(tb, 'pointermove', 250, 300);
    await frame();
    fire(tb, 'pointermove', 3, 320);       // dalam 8px dari tepi kiri
    await frame();                          // rAF menerapkan move ke posisi dekat tepi
    fire(tb, 'pointerup', 3, 320);
    const saved = stored()?.orders;
    expect(saved).toBeDefined();
    // Harapan: rect pemulihan = rect awal (300,150,800x500). Bila bug: x/y mengikuti posisi saat dilepas (dekat tepi kiri).
    expect({ x: saved!.x, y: saved!.y, w: saved!.w, h: saved!.h }).toEqual({ x: 300, y: 150, w: 800, h: 500 });
  });
});
