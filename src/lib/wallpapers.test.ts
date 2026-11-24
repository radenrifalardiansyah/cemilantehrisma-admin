import { describe, it, expect } from 'vitest';
import { WALLPAPER_IDS, type WallpaperId } from './appearance';
import { wallpaperBackground, normalizeHex, DEFAULT_WALLPAPER_ACCENT } from './wallpapers';

const MAX_BYTES = 4096;
const SVG_IDS = WALLPAPER_IDS.filter(i => i !== 'gradient');

describe('wallpaperBackground', () => {
  it('semua id kontrak menghasilkan string non-kosong dan tidak melempar', () => {
    for (const id of WALLPAPER_IDS) {
      const out = wallpaperBackground(id);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(10);
    }
    expect(() => wallpaperBackground('gradient')).not.toThrow();
    expect(() => wallpaperBackground('gradient', '#123456')).not.toThrow();
  });

  it('tidak memuat URL eksternal selain xmlns SVG, dan tidak ada url() selain data URI', () => {
    for (const id of WALLPAPER_IDS) {
      const out = wallpaperBackground(id, '#2F6FAE').replace('http://www.w3.org/2000/svg', '');
      expect(out).not.toMatch(/https?:/i);
      expect(out.replace(/url\("data:image\/svg\+xml,[^"]*"\)/, '')).not.toMatch(/url\(/);
    }
  });

  it('ukuran per latar di bawah batas', () => {
    for (const id of WALLPAPER_IDS) expect(wallpaperBackground(id).length).toBeLessThan(MAX_BYTES);
  });

  it('data URI aman: tanpa kutip ganda, # mentah, atau < > mentah di dalam url()', () => {
    for (const id of SVG_IDS) {
      const m = wallpaperBackground(id).match(/^url\("data:image\/svg\+xml,([^"]*)"\) center \/ cover no-repeat, #[0-9a-f]{6}$/);
      expect(m, id).not.toBeNull();
      expect(m![1]).not.toMatch(/[#<>]/);
      expect(decodeURIComponent(m![1])).toMatch(/^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg'.*<\/svg>$/);
    }
  });

  it('accent tidak valid memakai fallback (sama dengan tanpa accent)', () => {
    const bad = ['red', '#12', '#12345', '#GGGGGG', "#fff' onload='x", '<script>', '', 'url(javascript:1)', '#1234567'];
    for (const id of WALLPAPER_IDS) {
      const base = wallpaperBackground(id);
      for (const a of bad) {
        const out = wallpaperBackground(id, a);
        expect(out, `${id} ${a}`).toBe(base);
      }
    }
    expect(wallpaperBackground('nature', undefined)).toBe(wallpaperBackground('nature', DEFAULT_WALLPAPER_ACCENT));
  });

  it('accent valid mengubah output (termasuk bentuk #RGB), semua id', () => {
    for (const id of WALLPAPER_IDS) {
      const def = wallpaperBackground(id);
      const blue = wallpaperBackground(id, '#2F6FAE');
      expect(blue, id).not.toBe(def);
      expect(wallpaperBackground(id, '#26a'), id).toBe(wallpaperBackground(id, '#2266aa'));
    }
  });

  it('output deterministik', () => {
    for (const id of WALLPAPER_IDS) expect(wallpaperBackground(id, '#2E7D74')).toBe(wallpaperBackground(id, '#2E7D74'));
  });

  it('id di luar kontrak tidak melempar dan jatuh ke gradasi', () => {
    expect(wallpaperBackground('zzz' as WallpaperId)).toBe(wallpaperBackground('gradient'));
  });

  it("'gradient' default identik dengan latar Windows bawaan", () => {
    const g = wallpaperBackground('gradient');
    expect(g).toContain('rgba(240,138,60,.38)');
    expect(g).toContain('#3A1F10 0%, #24120A 55%, #1A0D06 100%');
  });
});

describe('normalizeHex', () => {
  it('menormalkan dan menolak', () => {
    expect(normalizeHex(' #ABC ')).toBe('#aabbcc');
    expect(normalizeHex('#D4691E')).toBe('#d4691e');
    expect(normalizeHex('D4691E')).toBeNull();
    expect(normalizeHex(5)).toBeNull();
  });
});
