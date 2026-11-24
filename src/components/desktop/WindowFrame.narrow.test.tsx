// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayoutDashboard } from 'lucide-react';
import WindowFrame, { NARROW_PX } from './WindowFrame';
import { makeArea, type WinState } from './window-reducer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = { tab: 'pos', label: 'Kasir', Icon: LayoutDashboard, color: '#D4691E', windowed: true, badge: 0 };
const win = (w: number): WinState => ({ tabId: 'pos', x: 10, y: 10, w, h: 500, z: 1, minimized: false, maximized: false });
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const render = (w: number) => act(() => root.render(
  <WindowFrame win={win(w)} area={makeArea(1600, 900, 'windows')} item={item} focused zIndex={1}
    onFocus={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} onMove={() => {}} onResize={() => {}}>x</WindowFrame>,
));

describe('WindowFrame data-narrow', () => {
  it('jendela di bawah ambang ditandai sempit; di atasnya tidak', () => {
    render(NARROW_PX - 1);
    expect(document.querySelector('.dsk-win')!.getAttribute('data-narrow')).toBe('true');
    render(NARROW_PX);
    expect(document.querySelector('.dsk-win')!.getAttribute('data-narrow')).toBe('false');
    render(1080);
    expect(document.querySelector('.dsk-win')!.getAttribute('data-narrow')).toBe('false');
  });
});
