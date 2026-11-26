// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import WidgetLayer from './WidgetLayer';
import type { DesktopWidgetsApi } from './registry';
import { makeArea } from '../window-reducer';
import type { WidgetInstance } from '@/lib/widgets';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('./ClockWidget', () => ({ default: () => { throw new Error('jam rusak'); } }));

const clock: WidgetInstance = { id: 'clk00001', type: 'clock', col: 0, row: 0, size: 's', config: {} };
const note: WidgetInstance = { id: 'not00001', type: 'note', col: 2, row: 0, size: 'm', config: { text: 'tetap hidup' } };

let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('WidgetBoundary', () => {
  it('widget yang melempar galat hanya menampilkan pesan di kartunya; kartu lain dan lapisan tetap hidup', () => {
    const api: DesktopWidgetsApi = { widgets: [clock, note], apply: () => true, setConfig: () => {}, creds: 't', can: () => true };
    act(() => root.render(<WidgetLayer api={api} area={makeArea(1600, 900, 'windows')} onContext={() => {}} />));
    expect(document.querySelectorAll('.dsk-wg')).toHaveLength(2);
    expect(document.querySelector('[data-widget-id="clk00001"] .dsk-wg-fail')?.textContent).toBe('Widget tidak dapat ditampilkan.');
    expect((document.querySelector('[data-widget-id="not00001"] textarea') as HTMLTextAreaElement).value).toBe('tetap hidup');
  });
});
