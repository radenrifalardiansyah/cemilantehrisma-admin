// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DesktopBoot from './DesktopBoot';
import { DEFAULT_APPEARANCE } from '@/lib/appearance';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (skin: 'windows' | 'mac', appearance?: Parameters<typeof DesktopBoot>[0]['appearance']) => {
  act(() => root.render(<DesktopBoot skin={skin} appearance={appearance} />));
  return host.querySelector<HTMLElement>('[role="status"]')!;
};
const htmlOf = (el: HTMLElement) => el.getAttribute('style') ?? '';

describe('DesktopBoot: pengaturan tampilan', () => {
  it('tanpa appearance atau dengan default: tanpa variabel kustom; latar = fallback gradasi bawaan skin', () => {
    for (const ap of [undefined, null, DEFAULT_APPEARANCE]) {
      const w = render('windows', ap);
      expect(w.style.getPropertyValue('--dsk-wallpaper') + w.style.getPropertyValue('--accent')).toBe('');
      expect(htmlOf(w)).toContain('#3A1F10 0%, #24120A 55%, #1A0D06 100%');
      const m = render('mac', ap);
      expect(m.style.getPropertyValue('--dsk-wallpaper') + m.style.getPropertyValue('--accent')).toBe('');
      expect(htmlOf(m)).toContain('#F2A86A 0%, #D4691E 42%, #5B2A12 100%');
    }
  });
  it('latar non-default: --dsk-wallpaper dipasang pada elemen boot; aksen non-brand memasang variabel aksen', () => {
    const el = render('windows', { ...DEFAULT_APPEARANCE, accent: 'blue', wallpaper: 'waves' });
    expect(el.style.getPropertyValue('--dsk-wallpaper')).toContain('data:image/svg+xml');
    expect(el.style.getPropertyValue('--accent')).toBe('#2D69A4');
  });
});
