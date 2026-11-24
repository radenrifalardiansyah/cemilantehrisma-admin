import { describe, expect, it } from 'vitest';
import { ACCENTS, ACCENT_META, DEFAULT_APPEARANCE, WALLPAPER_IDS } from './appearance';
import { accentVars, appearanceStyle } from './appearance-style';
import { wallpaperBackground } from './wallpapers';

describe('appearanceStyle', () => {
  it('default (brand + gradient) tidak menimpa apa pun: tampilan sama dengan sekarang', () => {
    expect(appearanceStyle(DEFAULT_APPEARANCE)).toEqual({});
  });
  it('aksen non-brand menimpa seluruh variabel aksen turunan', () => {
    const v = appearanceStyle({ ...DEFAULT_APPEARANCE, accent: 'blue' });
    for (const k of ['--accent', '--accent-dark', '--accent-light', '--accent-bg', '--accent-border', '--accent-grad', '--accent-grad-hover']) expect(v[k], k).toBeTruthy();
    expect(v['--accent']).toBe(ACCENT_META.blue.swatch);
    expect(v['--dsk-wallpaper']).toBeUndefined();
  });
  it('latar non-gradient memasang --dsk-wallpaper dari wallpaperBackground', () => {
    const v = appearanceStyle({ ...DEFAULT_APPEARANCE, wallpaper: 'waves' });
    expect(v['--dsk-wallpaper']).toBe(wallpaperBackground('waves', ACCENT_META.brand.swatch));
  });
  it('tiap aksen: teks putih terbaca di atas aksen (kontras >= 4.5)', () => {
    const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    for (const a of ACCENTS.filter(x => x !== 'brand')) {   // brand = warna bawaan sekarang (tidak di-override)
      const vars = accentVars(ACCENT_META[a].swatch);
      expect(1.05 / (lum(vars['--accent']) + 0.05), a).toBeGreaterThanOrEqual(4.5);
    }
  });
  const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  it('tombol primer: teks putih terbaca di ujung terang gradien --accent-grad (komentar sumber menjanjikan >= 4.5 untuk "aksen/gradiennya")', () => {
    for (const a of ACCENTS.filter(x => x !== 'brand')) {
      const first = /linear-gradient\(135deg, (#[0-9a-f]{6}),/.exec(accentVars(ACCENT_META[a].swatch)['--accent-grad'])![1];
      expect(contrast('#ffffff', first), a).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('opsi terpilih di dialog: teks --accent di atas --accent-bg terbaca (>= 4.5)', () => {
    for (const a of ACCENTS.filter(x => x !== 'brand')) {
      const v = accentVars(ACCENT_META[a].swatch);
      expect(contrast(v['--accent'], v['--accent-bg']), a).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('WALLPAPER_IDS sama dengan yang dihasilkan wallpapers.ts: tiap id punya latar tak kosong', () => {
    for (const id of WALLPAPER_IDS) expect(typeof wallpaperBackground(id, '#D4691E') === 'string' && wallpaperBackground(id).length > 0, id).toBe(true);
  });
});
