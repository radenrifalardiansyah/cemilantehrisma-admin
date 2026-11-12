// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Modal, { useEscapeLayer } from './Modal';

// Tes perilaku Modal/tumpukan Esc di jsdom (tanpa testing-library: render lewat react-dom/client + act).
// Keterbatasan: jsdom tidak punya layout, jadi getClientRects() distub agar focus trap bisa diuji.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  HTMLElement.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; };
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

const render = (ui: ReactNode) => act(() => root.render(ui));
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); });
const sheets = () => Array.from(document.querySelectorAll<HTMLElement>('.modal-sheet'));

describe('Modal: tumpukan Esc', () => {
  it('Esc memanggil onClose sekali', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p className="modal-title">A</p></Modal>);
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tombol selain Esc tidak menutup', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p>A</p></Modal>);
    key('Enter'); key('a');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('modal bertingkat (dibuka berurutan): Esc hanya menutup yang teratas', () => {
    const a = vi.fn(), b = vi.fn();
    function App({ showB }: { showB: boolean }) {
      return (<><Modal onClose={a}><p>A</p></Modal>{showB && <Modal onClose={b}><p>B</p></Modal>}</>);
    }
    render(<App showB={false} />);
    render(<App showB />);
    key('Escape');
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('setelah modal atas unmount, Esc berikutnya menutup modal di bawahnya', () => {
    const a = vi.fn(), b = vi.fn();
    function App({ showB }: { showB: boolean }) {
      return (<><Modal onClose={a}><p>A</p></Modal>{showB && <Modal onClose={b}><p>B</p></Modal>}</>);
    }
    render(<App showB={false} />);
    render(<App showB />);
    render(<App showB={false} />);
    key('Escape');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('Modal tanpa onClose tidak tertutup Esc dan memblokir Esc untuk modal di bawahnya', () => {
    const a = vi.fn();
    function App({ showB }: { showB: boolean }) {
      return (<><Modal onClose={a}><p>A</p></Modal>{showB && <Modal><p>B</p></Modal>}</>);
    }
    render(<App showB={false} />);
    render(<App showB />);
    key('Escape');
    expect(a).not.toHaveBeenCalled();
  });

  it('Esc diabaikan selama ada popover ([data-popover-layer]) di dokumen', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p>A</p></Modal>);
    const pop = document.createElement('div');
    pop.setAttribute('data-popover-layer', '');
    document.body.appendChild(pop);
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
    pop.remove();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc yang sudah di-preventDefault tidak menutup modal', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p>A</p></Modal>);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ev.preventDefault();
    act(() => { document.dispatchEvent(ev); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('guard saving: handler `!saving && close()` dihormati oleh Esc', () => {
    const close = vi.fn();
    let saving = true;
    render(<Modal onClose={() => !saving && close()}><p>A</p></Modal>);
    key('Escape');
    expect(close).not.toHaveBeenCalled();
    saving = false;
    key('Escape');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('listener dilepas saat unmount (Esc setelahnya tidak memanggil handler lama)', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p>A</p></Modal>);
    render(<div />);
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('memakai handler terbaru tanpa mendaftar ulang (closure tidak basi)', () => {
    const first = vi.fn(), second = vi.fn();
    render(<Modal onClose={first}><p>A</p></Modal>);
    render(<Modal onClose={second}><p>A</p></Modal>);
    key('Escape');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('StrictMode (efek dobel): tetap satu pemanggilan dan urutan tumpukan benar', () => {
    const a = vi.fn(), b = vi.fn();
    function App({ showB }: { showB: boolean }) {
      return (<StrictMode><Modal onClose={a}><p>A</p></Modal>{showB && <Modal onClose={b}><p>B</p></Modal>}</StrictMode>);
    }
    render(<App showB={false} />);
    render(<App showB />);
    key('Escape');
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('useEscapeLayer: lapisan non-Modal (mis. lightbox) di atas modal mengambil Esc', () => {
    const modal = vi.fn(), layer = vi.fn();
    function Layer() { useEscapeLayer(layer); return null; }
    function App({ show }: { show: boolean }) {
      return (<><Modal onClose={modal}><p>A</p></Modal>{show && <Layer />}</>);
    }
    render(<App show={false} />);
    render(<App show />);
    key('Escape');
    expect(layer).toHaveBeenCalledTimes(1);
    expect(modal).not.toHaveBeenCalled();
  });

  // Skenario berisiko: modal induk dan anak ter-mount di commit yang sama. Efek anak berjalan lebih dulu
  // daripada efek induk, sehingga token anak masuk tumpukan lebih dulu dan induk menjadi "teratas".
  it('modal bertingkat yang ter-mount bersamaan: Esc harus menutup modal DALAM (anak), bukan induk', () => {
    const outer = vi.fn(), inner = vi.fn();
    render(
      <Modal onClose={outer}>
        <p>luar</p>
        <Modal onClose={inner}><p>dalam</p></Modal>
      </Modal>,
    );
    key('Escape');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('Modal: fokus', () => {
  it('fokus awal ke sheet bila tidak ada elemen autofocus', () => {
    render(<Modal onClose={() => {}}><button>OK</button></Modal>);
    expect(document.activeElement).toBe(sheets()[0]);
  });

  it('autoFocus milik anak tidak direbut oleh sheet', () => {
    render(<Modal onClose={() => {}}><input data-testid="i" autoFocus /></Modal>);
    expect(document.activeElement).toBe(document.querySelector('input'));
  });

  it('fokus dikembalikan ke pemicu setelah modal ditutup', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    function App({ open }: { open: boolean }) {
      return open ? <Modal onClose={() => {}}><input autoFocus /></Modal> : null;
    }
    render(<App open />);
    expect(document.activeElement).not.toBe(trigger);
    render(<App open={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  it('fokus tidak dikembalikan bila pemicu sudah dilepas dari DOM', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    function App({ open }: { open: boolean }) {
      return open ? <Modal onClose={() => {}}><input autoFocus /></Modal> : null;
    }
    render(<App open />);
    trigger.remove();
    expect(() => render(<App open={false} />)).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it('fokus tidak ditarik ke pemicu bila pengguna sudah memindahkan fokus ke elemen lain saat tutup', () => {
    const trigger = document.createElement('button');
    const other = document.createElement('button');
    document.body.append(trigger, other);
    trigger.focus();
    function App({ open }: { open: boolean }) {
      return open ? <Modal onClose={() => {}}><input autoFocus /></Modal> : null;
    }
    render(<App open />);
    other.focus();
    render(<App open={false} />);
    expect(document.activeElement).toBe(other);
  });
});

describe('Modal: focus trap', () => {
  const setup = () => render(
    <Modal onClose={() => {}}>
      <button id="b1">1</button>
      <button id="b2">2</button>
      <button id="b3" disabled>3</button>
    </Modal>,
  );
  const el = (id: string) => document.getElementById(id) as HTMLElement;

  it('Tab dari elemen terakhir kembali ke elemen pertama (disabled dilewati)', () => {
    setup();
    el('b2').focus();
    key('Tab');
    expect(document.activeElement).toBe(el('b1'));
  });

  it('Shift+Tab dari elemen pertama pindah ke elemen terakhir', () => {
    setup();
    el('b1').focus();
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(el('b2'));
  });

  it('Tab saat fokus di sheet (belum ada fokus anak) masuk ke elemen pertama', () => {
    setup();
    expect(document.activeElement).toBe(sheets()[0]);
    key('Tab');
    expect(document.activeElement).toBe(el('b1'));
  });

  it('Tab saat fokus di luar modal (body) ditarik ke dalam', () => {
    setup();
    (document.activeElement as HTMLElement).blur();
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(el('b2'));
  });

  it('Tab di tengah daftar dibiarkan (tidak di-preventDefault)', () => {
    render(<Modal onClose={() => {}}><button id="x1" /><button id="x2" /><button id="x3" /></Modal>);
    el('x1').focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
  });

  it('hanya modal teratas yang menjebak fokus', () => {
    function App() {
      const [b, setB] = useState(false);
      return (
        <>
          <Modal onClose={() => {}}><button id="a1" onClick={() => setB(true)}>a1</button><button id="a2">a2</button></Modal>
          {b && <Modal onClose={() => {}}><button id="c1">c1</button><button id="c2">c2</button></Modal>}
        </>
      );
    }
    render(<App />);
    act(() => el('a1').click());
    el('c2').focus();
    key('Tab');
    expect(document.activeElement).toBe(el('c1'));
    // Fokus bocor ke modal bawah bukan tanggung jawab trap bawah: tidak ada tarikan ganda ke a1.
    expect(document.activeElement).not.toBe(el('a1'));
  });

  it('Tab di dalam popover (data-popover-layer) tidak dijebak ulang', () => {
    setup();
    const pop = document.createElement('div');
    pop.setAttribute('data-popover-layer', '');
    const inp = document.createElement('input');
    pop.appendChild(inp);
    document.body.appendChild(pop);
    inp.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(inp);
  });

  it('modal tanpa elemen fokus: Tab ditahan dan fokus tetap di sheet', () => {
    render(<Modal onClose={() => {}}><p>teks saja</p></Modal>);
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(sheets()[0]);
  });
});

describe('Modal: atribut aksesibilitas & overlay', () => {
  it('role default dialog + aria-modal; alertdialog bila diminta', () => {
    render(<Modal onClose={() => {}}><p>A</p></Modal>);
    expect(sheets()[0].getAttribute('role')).toBe('dialog');
    expect(sheets()[0].getAttribute('aria-modal')).toBe('true');
    render(<Modal role="alertdialog" onClose={() => {}}><p>A</p></Modal>);
    expect(sheets()[0].getAttribute('role')).toBe('alertdialog');
  });

  it('aria-labelledby menunjuk ke .modal-title (id otomatis bila belum ada)', () => {
    render(<Modal onClose={() => {}}><p className="modal-title">Judul</p></Modal>);
    const s = sheets()[0];
    const id = s.getAttribute('aria-labelledby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe('Judul');
  });

  it('id .modal-title yang sudah ada dipertahankan', () => {
    render(<Modal onClose={() => {}}><p className="modal-title" id="judul-saya">J</p></Modal>);
    expect(sheets()[0].getAttribute('aria-labelledby')).toBe('judul-saya');
  });

  it('tanpa .modal-title, ariaLabel dipakai', () => {
    render(<Modal onClose={() => {}} ariaLabel="Cari menu"><p>x</p></Modal>);
    expect(sheets()[0].getAttribute('aria-label')).toBe('Cari menu');
    expect(sheets()[0].hasAttribute('aria-labelledby')).toBe(false);
  });

  it('judul yang baru muncul setelah render awal tetap terhubung (aria-labelledby tidak basi)', () => {
    function App({ loaded }: { loaded: boolean }) {
      return <Modal onClose={() => {}}>{loaded ? <p className="modal-title">Detail</p> : <p>Memuat…</p>}</Modal>;
    }
    render(<App loaded={false} />);
    render(<App loaded />);
    expect(sheets()[0].getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('klik overlay menutup; klik di dalam sheet tidak', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><button id="in">x</button></Modal>);
    act(() => (document.getElementById('in') as HTMLElement).click());
    expect(onClose).not.toHaveBeenCalled();
    act(() => (document.querySelector('.modal-overlay') as HTMLElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tanpa onClose, klik overlay tidak melakukan apa-apa', () => {
    render(<Modal><p>x</p></Modal>);
    expect(() => act(() => (document.querySelector('.modal-overlay') as HTMLElement).click())).not.toThrow();
    expect(sheets()).toHaveLength(1);
  });

  it('className/overlayClassName ditambahkan di samping kelas dasar', () => {
    render(<Modal onClose={() => {}} className="modal-sm" overlayClassName="confirm-overlay"><p>x</p></Modal>);
    expect(sheets()[0].className).toBe('modal-sheet modal-sm');
    expect(document.querySelector('.modal-overlay')?.className).toBe('modal-overlay confirm-overlay');
  });
});
