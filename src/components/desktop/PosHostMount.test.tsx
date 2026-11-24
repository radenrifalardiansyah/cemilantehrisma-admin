// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, act, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PosHostMount, { posTopbarContext } from './PosHostMount';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const events = { mounts: 0, unmounts: 0 };
function Cart() {
  const [n, setN] = useState(0);
  useEffect(() => { events.mounts++; return () => { events.unmounts++; }; }, []);
  return <button id="cart" onClick={() => setN(x => x + 1)}>{n}</button>;
}

// Meniru AppShell: host Kasir stabil di <main>; isi tab Klasik dan jendela bergantian.
function Shell({ classicTab, windowOpen, inner }: { classicTab: boolean; windowOpen: boolean; inner?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const win: ReactNode = windowOpen ? <div id="win">{inner === false ? null : <PosHostMount hostRef={hostRef} />}</div> : null;
  return (
    <div id="shell">
      <main id="main">
        {classicTab && <div id="tabcontent">tab</div>}
        <div ref={hostRef} id="host" style={{ display: 'contents' }}><Cart /></div>
      </main>
      {win}
    </div>
  );
}

let host: HTMLDivElement; let root: Root;
beforeEach(() => { events.mounts = 0; events.unmounts = 0; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });
const render = (ui: ReactNode) => act(() => root.render(ui));
const $ = (s: string) => document.querySelector<HTMLElement>(s);

describe('PosHostMount: host Kasir stabil', () => {
  it('dipindah ke jendela dan kembali ke <main> tanpa remount; state keranjang awet', () => {
    render(<Shell classicTab={false} windowOpen={false} />);
    act(() => { $('#cart')!.click(); $('#cart')!.click(); });
    expect($('#cart')!.textContent).toBe('2');
    const cartNode = $('#cart');

    render(<Shell classicTab={false} windowOpen />);
    expect($('#host')!.parentElement!.classList.contains('dsk-pos-slot')).toBe(true);
    expect($('#host')!.style.display).toBe('flex');
    expect($('#cart')).toBe(cartNode);
    expect($('#cart')!.textContent).toBe('2');

    render(<Shell classicTab={false} windowOpen={false} />);
    expect($('#host')!.parentElement!.id).toBe('main');
    expect($('#host')!.style.display).toBe('contents');
    expect($('#cart')).toBe(cartNode);
    expect($('#cart')!.textContent).toBe('2');
    expect(events).toEqual({ mounts: 1, unmounts: 0 });
  });

  it('ganti mode Klasik <-> jendela berulang (isi tab Klasik disisipkan/dicabut di <main>) tidak error dan tidak me-remount', () => {
    render(<Shell classicTab windowOpen={false} />);
    act(() => { $('#cart')!.click(); });
    render(<Shell classicTab={false} windowOpen />);
    render(<Shell classicTab windowOpen={false} />);     // jendela dilepas, tab Klasik disisipkan sebelum host
    expect($('#tabcontent')!.nextElementSibling).toBe($('#host'));
    render(<Shell classicTab={false} windowOpen />);
    render(<Shell classicTab={false} windowOpen={false} />);
    expect($('#cart')!.textContent).toBe('1');
    expect(events).toEqual({ mounts: 1, unmounts: 0 });
  });

  it('tab Klasik muncul saat jendela masih memegang host: tidak melempar (host dikembalikan dulu)', () => {
    render(<Shell classicTab={false} windowOpen />);
    expect(() => render(<Shell classicTab windowOpen={false} />)).not.toThrow();
    expect($('#host')!.parentElement!.id).toBe('main');
  });
});

describe('PosHostMount: kasus tambahan', () => {
  it('StrictMode (efek ganda): host berakhir di slot jendela, lalu kembali ke <main> setelah jendela ditutup; state keranjang awet', () => {
    render(<StrictMode><Shell classicTab={false} windowOpen={false} /></StrictMode>);
    act(() => { $('#cart')!.click(); });
    render(<StrictMode><Shell classicTab={false} windowOpen /></StrictMode>);
    expect($('#host')!.parentElement!.classList.contains('dsk-pos-slot')).toBe(true);
    expect($('#host')!.style.display).toBe('flex');
    render(<StrictMode><Shell classicTab={false} windowOpen={false} /></StrictMode>);
    expect($('#host')!.parentElement!.id).toBe('main');
    expect($('#host')!.style.display).toBe('contents');
    expect($('#cart')!.textContent).toBe('1');
  });

  it('host dikembalikan tepat sebelum saudara yang mengikutinya (bukan ke akhir <main>)', () => {
    function WithTail({ open }: { open: boolean }) {
      const hostRef = useRef<HTMLDivElement>(null);
      return (
        <div>
          <main id="main"><div ref={hostRef} id="host" style={{ display: 'contents' }}><Cart /></div><i id="tail" /></main>
          {open && <div id="win"><PosHostMount hostRef={hostRef} /></div>}
        </div>
      );
    }
    render(<WithTail open={false} />);
    render(<WithTail open />);
    render(<WithTail open={false} />);
    expect($('#host')!.nextElementSibling).toBe($('#tail'));
  });

  it('jendela diganti baru dalam satu commit (mis. ganti skin: key berubah): host pindah ke slot baru tanpa remount', () => {
    function Swap({ k }: { k: string }) {
      const hostRef = useRef<HTMLDivElement>(null);
      return (
        <div>
          <main id="main"><div ref={hostRef} id="host" style={{ display: 'contents' }}><Cart /></div></main>
          <div key={k} id={`win-${k}`}><PosHostMount hostRef={hostRef} /></div>
        </div>
      );
    }
    render(<Swap k="a" />);
    expect(() => render(<Swap k="b" />)).not.toThrow();
    expect($('#host')!.closest('#win-b')).not.toBeNull();
    expect($('#win-a')).toBeNull();
    expect(events).toEqual({ mounts: 1, unmounts: 0 });
  });

  it('buka-tutup 20 kali berturut-turut: tetap satu host, tidak ada remount', () => {
    render(<Shell classicTab={false} windowOpen={false} />);
    for (let i = 0; i < 20; i++) {
      render(<Shell classicTab={false} windowOpen />);
      render(<Shell classicTab={false} windowOpen={false} />);
    }
    expect(document.querySelectorAll('#host')).toHaveLength(1);
    expect($('#host')!.parentElement!.id).toBe('main');
    expect(events).toEqual({ mounts: 1, unmounts: 0 });
  });
});


describe('posTopbarContext', () => {
  it('tanpa jendela: undefined; jendela ada tapi slot belum ada: null; slot ada: slotnya', () => {
    const el = document.createElement('div');
    expect(posTopbarContext(false, undefined)).toBeUndefined();
    expect(posTopbarContext(false, el)).toBeUndefined();
    expect(posTopbarContext(true, undefined)).toBeNull();
    expect(posTopbarContext(true, null)).toBeNull();
    expect(posTopbarContext(true, el)).toBe(el);
  });
});
