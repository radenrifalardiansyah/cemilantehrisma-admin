// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ChatWidget from './ChatWidget';

vi.mock('./ChatPanel', () => ({ default: () => <div id="panel" />, }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const props = { username: 'a', creds: 'c', avatar: null, canKick: false, onForceLogout: () => {}, onPendingLoginRequest: () => {} };
const render = (tray?: HTMLElement | null) => act(() => root.render(<ChatWidget {...props} tray={tray} />));

describe('ChatWidget mode tray', () => {
  it('tanpa prop tray (Klasik): FAB mengambang seperti biasa', () => {
    render(undefined);
    expect(document.querySelector('.chat-fab')).not.toBeNull();
    expect(document.querySelector('.dsk-chat-btn')).toBeNull();
  });
  it('tray null (slot belum terpasang): tidak ada FAB maupun tombol', () => {
    render(null);
    expect(document.querySelector('.chat-fab')).toBeNull();
    expect(document.querySelector('.dsk-chat-btn')).toBeNull();
  });
  it('tray elemen: tombol kecil di-portal ke slot, tanpa FAB; klik membuka/menutup panel yang sama', () => {
    const slot = document.createElement('span'); document.body.appendChild(slot);
    render(slot);
    expect(document.querySelector('.chat-fab')).toBeNull();
    const btn = slot.querySelector<HTMLButtonElement>('.dsk-chat-btn')!;
    expect(btn.getAttribute('aria-label')).toBe('Akun & Chat');
    act(() => btn.click());
    expect(document.querySelector('#panel')).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});
