// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Field from './Field';
import SearchSelect from './SearchSelect';
import FilterSelect from './FilterSelect';
import SearchableSelect from './SearchableSelect';
import NumberInput from './NumberInput';
import DateTimeInput, { DateInput, MonthInput } from './DateTimeInput';

// Tes Field: pasangan label/kontrol (htmlFor <-> id) untuk elemen native dan semua kontrol kustom
// yang dipakai di dalam <Field>. Render lewat react-dom/client + act (tanpa testing-library).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; vi.restoreAllMocks(); });
const render = (ui: ReactNode) => act(() => root.render(ui));
const label = () => host.querySelector('label') as HTMLLabelElement;
const target = () => document.getElementById(label().htmlFor);
const noop = () => {};
const countById = (id: string) => Array.from(document.querySelectorAll('[id]')).filter(e => e.id === id).length;

describe('Field: pasangan label dan kontrol', () => {
  it('input native mendapat id otomatis yang sama dengan label.htmlFor', () => {
    render(<Field label="Nama"><input className="input" /></Field>);
    const input = host.querySelector('input')!;
    expect(input.id).toBeTruthy();
    expect(label().htmlFor).toBe(input.id);
  });

  it('id yang sudah ada pada kontrol dipakai, tidak ditimpa', () => {
    render(<Field label="Nama"><input id="nama-saya" /></Field>);
    expect(host.querySelector('input')!.id).toBe('nama-saya');
    expect(label().htmlFor).toBe('nama-saya');
  });

  it('dua Field berbeda mendapat id unik', () => {
    render(<><Field label="A"><input /></Field><Field label="B"><input /></Field></>);
    const ids = Array.from(host.querySelectorAll('input')).map(i => i.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('textarea dan select native ikut dilabeli', () => {
    render(<><Field label="Cat"><textarea /></Field><Field label="Pilih"><select><option>x</option></select></Field></>);
    for (const l of Array.from(host.querySelectorAll('label'))) {
      expect(document.getElementById(l.htmlFor)).toBeTruthy();
    }
  });

  it('anak pertama = kontrol; hint sesudahnya dirender apa adanya tanpa id', () => {
    render(<Field label="Nama"><input /><p className="hint">petunjuk</p></Field>);
    expect(host.querySelector('.hint')!.id).toBe('');
    expect(host.querySelector('.hint')!.textContent).toBe('petunjuk');
  });

  it('tanda wajib (*) tampil hanya bila required', () => {
    render(<><Field label="A" required><input /></Field><Field label="B"><input /></Field></>);
    const [a, b] = Array.from(host.querySelectorAll('label'));
    expect(a.textContent).toContain('*');
    expect(b.textContent).not.toContain('*');
  });

  it('tanpa anak berupa elemen (hanya teks): label tanpa htmlFor dan tidak error', () => {
    render(<Field label="Info">hanya teks</Field>);
    expect(label().hasAttribute('for')).toBe(false);
    expect(host.textContent).toContain('hanya teks');
  });

  it('anak null/false (kondisional kosong) tidak membuat error dan label tanpa htmlFor', () => {
    render(<Field label="X">{false}{null}</Field>);
    expect(label().hasAttribute('for')).toBe(false);
  });

  it('anak kondisional yang berganti dari <p> ke kontrol: id tetap tersambung ke kontrol baru', () => {
    const App = ({ ready }: { ready: boolean }) => (
      <Field label="Dompet">{ready ? <SearchSelect value="" onChange={noop} options={[]} /> : <p>Memuat…</p>}</Field>
    );
    render(<App ready={false} />);
    render(<App ready />);
    expect(target()?.tagName).toBe('BUTTON');
  });

  it('Fragment sebagai anak pertama TIDAK boleh menerima prop id (React memperingatkan)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(noop);
    render(<Field label="F"><><input /></></Field>);
    const diperingatkan = err.mock.calls.some(c => String(c[0]).includes('Invalid prop') || String(c[0]).includes('Fragment'));
    expect(diperingatkan).toBe(false);
  });

});

describe('Field: kontrol kustom meneruskan id ke elemen yang bisa difokus', () => {
  const cases: [string, ReactNode][] = [
    ['SearchSelect', <SearchSelect key="a" value="" onChange={noop} options={[{ value: '1', label: 'Satu' }]} />],
    ['FilterSelect', <FilterSelect key="b" value="" onChange={noop} options={[{ value: '1', label: 'Satu' }]} />],
    ['FilterSelect searchable=false', <FilterSelect key="b2" searchable={false} value="" onChange={noop} options={[{ value: '1', label: 'Satu' }]} />],
    ['SearchableSelect', <SearchableSelect key="c" value="" onChange={noop} options={[{ value: '1', label: 'Satu' }]} />],
    ['DateInput', <DateInput key="d" value="" onChange={noop} />],
    ['MonthInput', <MonthInput key="e" value="" onChange={noop} />],
    ['DateTimeInput', <DateTimeInput key="f" value="" onChange={noop} />],
    ['NumberInput', <NumberInput key="g" value="" onChange={noop} />],
  ];
  it.each(cases)('%s: label.htmlFor -> elemen BUTTON/INPUT yang bisa difokus', (_n, ctl) => {
    render(<Field label="Kontrol">{ctl}</Field>);
    const t = target();
    expect(t).toBeTruthy();
    expect(['BUTTON', 'INPUT']).toContain(t!.tagName);
    expect((t as HTMLButtonElement | HTMLInputElement).disabled).toBe(false);
    t!.focus();
    expect(document.activeElement).toBe(t);
    // id unik di dokumen
    expect(countById(t!.id)).toBe(1);
  });

  it('id eksplisit pada kontrol kustom diteruskan apa adanya', () => {
    render(<Field label="Bulan"><MonthInput id="bln" value="2026-11" onChange={noop} /></Field>);
    expect(label().htmlFor).toBe('bln');
    expect(document.getElementById('bln')?.tagName).toBe('BUTTON');
  });

  it('klik label pemilih berbasis tombol membuka popover (seperti <select> native)', () => {
    render(<Field label="Pilih"><SearchSelect value="" onChange={noop} options={[{ value: '1', label: 'Satu' }]} /></Field>);
    act(() => label().click());
    expect(document.querySelector('[data-popover-layer]')).toBeTruthy();
  });

  it('DateTimeInput: id hanya ke tombol tanggal, bukan tombol jam (tidak ada id ganda)', () => {
    render(<Field label="Waktu"><DateTimeInput value="2026-11-05T14:30" onChange={noop} /></Field>);
    const t = target()!;
    expect(countById(t.id)).toBe(1);
  });
});

describe('MonthInput', () => {
  const open = () => act(() => (host.querySelector('button') as HTMLButtonElement).click());
  const monthBtns = () => Array.from(document.querySelectorAll('[data-popover-layer] button')).filter(b => /^(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)$/.test(b.textContent || '')) as HTMLButtonElement[];

  it('menampilkan "Pilih bulan" bila kosong dan nama bulan lengkap bila terisi', () => {
    render(<MonthInput value="" onChange={noop} />);
    expect(host.textContent).toContain('Pilih bulan');
    render(<MonthInput value="2026-03" onChange={noop} />);
    expect(host.textContent).toContain('Maret 2026');
  });

  it('value tidak valid diperlakukan sebagai kosong', () => {
    render(<MonthInput value="2026-3" onChange={noop} />);
    expect(host.textContent).toContain('Pilih bulan');
  });

  it('memilih bulan memanggil onChange "YYYY-MM" dan menutup popover', () => {
    const onChange = vi.fn();
    render(<MonthInput value="2026-03" onChange={onChange} />);
    open();
    act(() => monthBtns().find(b => b.textContent === 'Agu')!.click());
    expect(onChange).toHaveBeenCalledWith('2026-08');
    expect(document.querySelector('[data-popover-layer]')).toBeNull();
  });

  it('min/max menonaktifkan bulan di luar rentang', () => {
    render(<MonthInput value="2026-06" min="2026-04" max="2026-09" onChange={noop} />);
    open();
    const dis = monthBtns().filter(b => b.disabled).map(b => b.textContent);
    expect(dis).toEqual(['Jan', 'Feb', 'Mar', 'Okt', 'Nov', 'Des']);
  });

  it('tombol tahun sebelumnya dikunci di tahun min, berikutnya di tahun max', () => {
    render(<MonthInput value="2026-06" min="2026-01" max="2026-12" onChange={noop} />);
    open();
    const prev = document.querySelector('[aria-label="Tahun sebelumnya"]') as HTMLButtonElement;
    const next = document.querySelector('[aria-label="Tahun berikutnya"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);
  });

  it('navigasi tahun mengubah tahun grid; membuka ulang mereset ke tahun nilai terpilih', () => {
    render(<MonthInput value="2026-06" onChange={noop} />);
    open();
    act(() => (document.querySelector('[aria-label="Tahun berikutnya"]') as HTMLButtonElement).click());
    expect(document.querySelector('[data-popover-layer]')!.textContent).toContain('2027');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    open();
    expect(document.querySelector('[data-popover-layer]')!.textContent).toContain('2026');
  });

  it('disabled: tombol tidak bisa membuka popover', () => {
    render(<MonthInput value="" onChange={noop} disabled />);
    open();
    expect(document.querySelector('[data-popover-layer]')).toBeNull();
  });
});

describe('FilterSelect searchable', () => {
  const opts = [{ value: 'a', label: 'Alfa' }, { value: 'b', label: 'Beta' }];
  const open = () => act(() => (host.querySelector('button') as HTMLButtonElement).click());

  it('default: ada kotak cari di panel', () => {
    render(<FilterSelect value="" onChange={noop} options={opts} />);
    open();
    expect(document.querySelector('[data-popover-layer] input')).toBeTruthy();
  });

  it('searchable=false: tanpa kotak cari tetapi opsi tetap bisa dipilih', () => {
    const onChange = vi.fn();
    render(<FilterSelect searchable={false} value="" onChange={onChange} options={opts} />);
    open();
    expect(document.querySelector('[data-popover-layer] input')).toBeNull();
    const beta = Array.from(document.querySelectorAll('[data-popover-layer] button')).find(b => b.textContent?.includes('Beta')) as HTMLButtonElement;
    act(() => beta.click());
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
