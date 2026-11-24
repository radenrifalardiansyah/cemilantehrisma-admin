// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AppearanceDialog, { type AppearanceDialogProps } from './AppearanceDialog';
import { DEFAULT_APPEARANCE } from '@/lib/appearance';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function setup(over: Partial<AppearanceDialogProps> = {}) {
  const props: AppearanceDialogProps = {
    value: DEFAULT_APPEARANCE, saved: DEFAULT_APPEARANCE,
    onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onReset: vi.fn(), ...over,
  };
  act(() => root.render(<AppearanceDialog {...props} />));
  return props;
}
const q = (s: string) => document.querySelector<HTMLElement>(s)!;
const group = (name: string) => q(`[role="radiogroup"][aria-label="${name}"]`);
const radios = (name: string) => Array.from(group(name).querySelectorAll<HTMLElement>('[role="radio"]'));
const radio = (name: string, text: string) => radios(name).find(r => r.textContent!.includes(text))!;
const btn = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent!.trim() === text)!;
const click = (el: HTMLElement) => act(() => { el.click(); });

describe('AppearanceDialog', () => {
  it('menampilkan judul, subjudul, dan semua pilihan berlabel', () => {
    setup();
    expect(document.body.textContent).toContain('Tampilan');
    expect(document.body.textContent).toContain('Berlaku untuk akun Anda di mode Desktop');
    expect(radios('Warna dasar').map(r => r.textContent)).toEqual(['Karamel', 'Biru', 'Teal', 'Hijau', 'Grafit', 'Ungu', 'Rose']);
    expect(radios('Latar desktop').map(r => r.textContent)).toEqual(['Gradasi', 'Gelombang', 'Jaringan', 'Geometri', 'Alam', 'Kota', 'Arsitektur', 'Kantor', 'Tim']);
    expect(radios('Kerapatan').map(r => r.textContent!.trim())).toEqual(['Rapat', 'Standar', 'Lega']);
    expect(radios('Ukuran teks').map(r => r.textContent)).toEqual(['AaKecil', 'AaStandar', 'AaBesar']);
    expect(document.body.textContent).toContain('Pengaturan tersimpan di akun Anda.');
  });

  it('klik pilihan memanggil onChange dengan patch yang benar', () => {
    const p = setup();
    click(radio('Warna dasar', 'Teal'));
    click(radio('Latar desktop', 'Kota'));
    click(radio('Kerapatan', 'Lega'));
    click(radio('Ukuran teks', 'Besar'));
    expect(p.onChange).toHaveBeenNthCalledWith(1, { accent: 'teal' });
    expect(p.onChange).toHaveBeenNthCalledWith(2, { wallpaper: 'city' });
    expect(p.onChange).toHaveBeenNthCalledWith(3, { density: 'relaxed' });
    expect(p.onChange).toHaveBeenNthCalledWith(4, { textSize: 'large' });
  });

  it('tanda terpilih mengikuti value (aria-checked, roving tabindex)', () => {
    setup({ value: { accent: 'rose', wallpaper: 'team', density: 'compact', textSize: 'small' } });
    for (const [g, t] of [['Warna dasar', 'Rose'], ['Latar desktop', 'Tim'], ['Kerapatan', 'Rapat'], ['Ukuran teks', 'Kecil']]) {
      const checked = radios(g).filter(r => r.getAttribute('aria-checked') === 'true');
      expect(checked).toHaveLength(1);
      expect(checked[0].textContent).toContain(t);
      expect(checked[0].tabIndex).toBe(0);
    }
  });

  it('panah keyboard memilih pilihan berikutnya', () => {
    const p = setup();
    act(() => { radio('Kerapatan', 'Standar').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(p.onChange).toHaveBeenCalledWith({ density: 'relaxed' });
  });

  it('Simpan nonaktif bila value sama dengan saved, aktif bila berbeda', () => {
    setup();
    expect((btn('Simpan') as HTMLButtonElement).disabled).toBe(true);
    setup({ value: { ...DEFAULT_APPEARANCE, accent: 'blue' } });
    expect((btn('Simpan') as HTMLButtonElement).disabled).toBe(false);
  });

  it('saat busy: Simpan nonaktif dan tombol lain terkunci', () => {
    setup({ value: { ...DEFAULT_APPEARANCE, accent: 'blue' }, busy: true });
    expect((document.querySelector('.btn-primary') as HTMLButtonElement).disabled).toBe(true);
    expect((btn('Batal') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Batal, Tutup, Kembalikan default, dan Simpan memanggil callback', () => {
    const p = setup({ value: { ...DEFAULT_APPEARANCE, accent: 'blue' } });
    click(btn('Batal'));
    click(q('[aria-label="Tutup"]'));
    click(btn('Kembalikan default'));
    click(btn('Simpan'));
    expect(p.onCancel).toHaveBeenCalledTimes(2);
    expect(p.onReset).toHaveBeenCalledTimes(1);
    expect(p.onSave).toHaveBeenCalledTimes(1);
  });

  it('dialog beraria-modal dan berjudul', () => {
    setup();
    const d = q('[role="dialog"]');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-labelledby')).toBeTruthy();
  });
  const esc = () => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  it('Esc dan klik di luar dialog menutup (onCancel) saat tidak busy', () => {
    const p = setup({ value: { ...DEFAULT_APPEARANCE, accent: 'blue' } });
    esc();
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    click(q('.modal-overlay'));
    expect(p.onCancel).toHaveBeenCalledTimes(2);
  });
  it('saat busy: Esc dan klik di luar tidak menutup dan tidak memanggil callback apa pun', () => {
    const p = setup({ value: { ...DEFAULT_APPEARANCE, accent: 'blue' }, busy: true });
    esc();
    click(q('.modal-overlay'));
    expect(p.onCancel).not.toHaveBeenCalled();
    expect(p.onSave).not.toHaveBeenCalled();
    expect(p.onReset).not.toHaveBeenCalled();
    expect(btn('Menyimpan...')).toBeTruthy();
  });
});
