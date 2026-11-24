// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayoutDashboard } from 'lucide-react';
import Dock from './Dock';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items = [{ tab: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard, color: '#D4691E', windowed: true, badge: 0 }];
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root.render(<Dock items={items} openTabs={new Set()} launchpadOpen={false} onLaunchpad={() => {}} onItem={() => {}} />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const scroller = () => host.querySelector<HTMLElement>('.dsk-dock-scroll')!;
const size = (scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(scroller(), 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(scroller(), 'clientWidth', { configurable: true, value: clientWidth });
};
const wheel = (deltaY: number, deltaX = 0) => {
  const ev = new WheelEvent('wheel', { deltaY, deltaX, bubbles: true, cancelable: true });
  host.querySelector('.dsk-dk')!.dispatchEvent(ev);
  return ev;
};

describe('Dock: roda mouse vertikal menggulir dock mendatar', () => {
  it('dock meluap: deltaY menggeser scrollLeft dan mencegah gulir halaman', () => {
    size(900, 300);
    const ev = wheel(120);
    expect(scroller().scrollLeft).toBe(120);
    expect(ev.defaultPrevented).toBe(true);
  });
  it('dock tidak meluap: roda tidak dicegat (gulir halaman tetap)', () => {
    size(300, 300);
    const ev = wheel(120);
    expect(scroller().scrollLeft).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });
  it('gestur mendatar (|deltaX| >= |deltaY|) dibiarkan ke peramban', () => {
    size(900, 300);
    const ev = wheel(10, 80);
    expect(scroller().scrollLeft).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });
});
