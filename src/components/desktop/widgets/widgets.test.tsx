// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ClockWidget, { clockParts } from './ClockWidget';
import NoteWidget from './NoteWidget';
import WidgetCard from './WidgetCard';
import { WidgetBoundary } from './WidgetLayer';
import { useWidgetPolling, type PollContext } from './use-widget-polling';
import { Clock } from 'lucide-react';
import type { WidgetProps } from './registry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

const props = (over: Partial<WidgetProps> = {}): WidgetProps => ({ id: 'w1', size: 's', config: {}, onConfigChange: () => {}, active: true, creds: 't', can: () => true, ...over });
const q = (sel: string) => document.querySelector<HTMLElement>(sel);

describe('clockParts', () => {
  it('format HH:mm (titik dua), tanggal Indonesia lengkap, zona Asia/Jakarta', () => {
    // 2026-11-26 03:07:09 UTC = 10:07:09 WIB (Kamis)
    const p = clockParts(new Date(Date.UTC(2026, 10, 26, 3, 7, 9)));
    expect(p.time).toBe('10:07');
    expect(p.seconds).toBe('09');
    expect(p.date).toBe('Kamis, 26 November 2026');
  });
  it('lintas hari mengikuti WIB, tengah malam 00:00 (bukan 24:00)', () => {
    const p = clockParts(new Date(Date.UTC(2026, 10, 26, 17, 0, 0)));   // 00:00 WIB 27 Nov
    expect(p.time).toBe('00:00'); expect(p.date).toBe('Jumat, 27 November 2026');
  });
});

describe('ClockWidget', () => {
  it('menampilkan jam besar dan tanggal; detik hanya bila config.format = hms', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 26, 3, 7, 9)));
    act(() => root.render(<ClockWidget {...props()} />));
    expect(q('.dsk-wg-time')!.textContent).toBe('10:07');
    expect(q('.dsk-wg-date')!.textContent).toBe('Kamis, 26 November 2026');
    expect(q('.dsk-wg-sec')).toBeNull();
    act(() => root.render(<ClockWidget {...props({ config: { format: 'hms' } })} />));
    expect(q('.dsk-wg-sec')!.textContent).toBe(':09');
  });

  it('memperbarui tiap detik hanya saat active; satu timer; berhenti dan dibersihkan saat active=false dan unmount', () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 26, 3, 7, 59)));
    act(() => root.render(<ClockWidget {...props({ config: { format: 'hms' } })} />));
    expect(vi.getTimerCount()).toBe(2);   // interval + penyegaran awal (setTimeout 0)
    act(() => { vi.advanceTimersByTime(1000); });
    expect(q('.dsk-wg-time')!.textContent).toBe('10:08:00');
    act(() => root.render(<ClockWidget {...props({ active: false, config: { format: 'hms' } })} />));
    expect(vi.getTimerCount()).toBe(0);
    const before = q('.dsk-wg-time')!.textContent;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(q('.dsk-wg-time')!.textContent).toBe(before);
    act(() => root.render(<ClockWidget {...props()} />));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });
});

describe('NoteWidget', () => {
  it('menampilkan teks, placeholder, label; mengetik memanggil onConfigChange({text})', () => {
    const onChange = vi.fn();
    act(() => root.render(<NoteWidget {...props({ size: 'm', config: { text: 'hai' }, onConfigChange: onChange })} />));
    const ta = q('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('hai'); expect(ta.placeholder).toContain('catatan'); expect(ta.getAttribute('aria-label')).toBe('Catatan tempel'); expect(ta.maxLength).toBe(500);
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'hai dunia'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith({ text: 'hai dunia' });
  });
  it('config tanpa text yang valid -> kosong', () => {
    act(() => root.render(<NoteWidget {...props({ size: 'm', config: { text: 5 } })} />));
    expect((q('textarea') as HTMLTextAreaElement).value).toBe('');
  });
  it('terkontrol penuh: nilai mengikuti prop (state di hook), tanpa state lokal yang bisa menimpa', () => {
    function Wrap() { const [c, setC] = useState({ text: 'a' }); return <NoteWidget {...props({ size: 'm', config: c, onConfigChange: n => setC(n as { text: string }) })} />; }
    act(() => root.render(<Wrap />));
    const ta = q('textarea') as HTMLTextAreaElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'ab'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    expect((q('textarea') as HTMLTextAreaElement).value).toBe('ab');
  });
});

describe('WidgetCard', () => {
  it('header ikon+judul, tombol menu berlabel, isi; fokusable; atribut ukuran/seret', () => {
    const onMenu = vi.fn();
    act(() => root.render(<WidgetCard Icon={Clock} title="Judul" size="m" dragging onMenu={onMenu}><span id="isi">x</span></WidgetCard>));
    const c = q('.dsk-wg')!;
    expect(c.tabIndex).toBe(0); expect(c.getAttribute('data-size')).toBe('m'); expect(c.getAttribute('data-dragging')).toBe('true');
    expect(q('.dsk-wg-title')!.textContent).toBe('Judul');
    expect(q('#isi')!.closest('.dsk-wg-body')).not.toBeNull();
    act(() => { q('.dsk-wg-menu')!.click(); });
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(q('.dsk-wg-menu')!.getAttribute('aria-label')).toBe('Menu widget Judul');
  });
});

describe('useWidgetPolling', () => {
  function Poller({ fn, active, ms = 1000 }: { fn: (c: PollContext) => Promise<void> | void; active: boolean; ms?: number }) { useWidgetPolling(fn, ms, active); return null; }
  const setVis = (v: 'visible' | 'hidden') => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
  beforeEach(() => { vi.spyOn(document, 'hasFocus').mockReturnValue(true); setVis('visible'); });

  it('berjalan segera saat active lalu tiap interval; berhenti saat active=false dan timer dibersihkan', async () => {
    const fn = vi.fn();
    await act(async () => root.render(<Poller fn={fn} active />));
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fn).toHaveBeenCalledTimes(4);
    await act(async () => root.render(<Poller fn={fn} active={false} />));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('tidak dijalankan sama sekali bila active=false sejak awal', async () => {
    const fn = vi.fn();
    await act(async () => root.render(<Poller fn={fn} active={false} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fn).not.toHaveBeenCalled();
  });

  it('berhenti saat tab tersembunyi dan lanjut (langsung) saat terlihat lagi; juga saat jendela blur', async () => {
    const fn = vi.fn();
    await act(async () => root.render(<Poller fn={fn} active />));
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { setVis('hidden'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { setVis('visible'); });
    expect(fn).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    await act(async () => { window.dispatchEvent(new Event('blur')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fn).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('tidak menumpuk: tik dilewati selama fn sebelumnya masih berjalan', async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>(r => { release = r; }));
    await act(async () => root.render(<Poller fn={fn} active />));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('penjaga urutan: hasil putaran yang usang (setelah stop/unmount) ditandai tidak terbaru dan request dibatalkan', async () => {
    const seen: { ctx: PollContext }[] = [];
    const fn = vi.fn(async (ctx: PollContext) => { seen.push({ ctx }); await new Promise(() => {}); });
    await act(async () => root.render(<Poller fn={fn} active />));
    const first = seen[0].ctx;
    expect(first.isLatest()).toBe(true); expect(first.signal.aborted).toBe(false);
    await act(async () => root.render(<Poller fn={fn} active={false} />));
    expect(first.isLatest()).toBe(false); expect(first.signal.aborted).toBe(true);
  });

  it('galat dari fn tidak menjatuhkan polling (dilog) dan polling berlanjut', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new Error('jaringan'); });
    await act(async () => root.render(<Poller fn={fn} active />));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalled();
  });
});

describe('WidgetBoundary', () => {
  function Boom({ fail }: { fail: boolean }) { if (fail) throw new Error('rusak'); return <span id="ok">ok</span>; }
  it('galat dirender sebagai pesan kecil; pulih saat resetKey berubah (mis. config diubah)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => root.render(<WidgetBoundary resetKey="a"><Boom fail /></WidgetBoundary>));
    expect(q('.dsk-wg-fail')).not.toBeNull();
    act(() => root.render(<WidgetBoundary resetKey="a"><Boom fail={false} /></WidgetBoundary>));
    expect(q('.dsk-wg-fail')).not.toBeNull();            // kunci sama: tetap gagal
    act(() => root.render(<WidgetBoundary resetKey="b"><Boom fail={false} /></WidgetBoundary>));
    expect(q('#ok')).not.toBeNull(); expect(q('.dsk-wg-fail')).toBeNull();
  });
});
