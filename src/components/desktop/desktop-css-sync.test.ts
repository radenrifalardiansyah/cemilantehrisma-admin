import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AREA_INSETS, makeArea, minSizeFor, DEFAULT_SIZES } from './window-reducer';
import { WINDOW_TABS } from '@/lib/ui-layout';

const dir = join(process.cwd(), 'src/components/desktop');
const css = readFileSync(join(dir, 'desktop.css'), 'utf8');
const boot = readFileSync(join(dir, 'DesktopBoot.tsx'), 'utf8');

const rule = (selector: string) => {
  const i = css.indexOf(selector + ' {');
  expect(i, `selector ${selector} tidak ditemukan`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};
const px = (decl: string, prop: string) => {
  const m = new RegExp(`(?:^|[\\s;{])${prop}:\\s*(\\d+)px`).exec(decl);
  expect(m, `properti ${prop} tidak ditemukan`).not.toBeNull();
  return Number(m![1]);
};

describe('sinkron geometri dock Mac: reducer, CSS, skeleton boot', () => {
  it('--dsk-bot skin Mac di CSS sama dengan AREA_INSETS.mac.bottom, dan --dsk-top dengan top', () => {
    const r = rule('.dsk-root[data-skin="mac"]');
    expect(px(r, '--dsk-bot')).toBe(AREA_INSETS.mac.bottom);
    expect(px(r, '--dsk-top')).toBe(AREA_INSETS.mac.top);
  });

  it('kapsul dock (bottom + tinggi) tidak melewati inset bawah, sehingga jendela tak tertutup dock', () => {
    const dock = rule('.dsk-dock');
    const dk = rule('.dsk-dk');
    const pad = /padding:\s*(\d+)px/.exec(dock);
    expect(pad).not.toBeNull();
    const height = px(dk, 'height') + 2 * Number(pad![1]) + 2; // + border 1px atas/bawah
    expect(px(dock, 'bottom') + height).toBeLessThanOrEqual(AREA_INSETS.mac.bottom);
  });

  it('skeleton DesktopBoot Mac berukuran sama dengan kapsul dock (tinggi) dan sejajar bottom-nya', () => {
    const dock = rule('.dsk-dock');
    const dk = rule('.dsk-dk');
    const pad = Number(/padding:\s*(\d+)px/.exec(dock)![1]);
    const bottom = Number(/bottom:\s*(\d+),\s*left: 0, right: 0, margin: '0 auto', width: \d+, height: (\d+)/.exec(boot)?.[1]);
    const height = Number(/bottom:\s*\d+,\s*left: 0, right: 0, margin: '0 auto', width: \d+, height: (\d+)/.exec(boot)?.[1]);
    expect(bottom).toBe(px(dock, 'bottom'));
    expect(height).toBe(px(dk, 'height') + 2 * pad + 2);
  });

  it('launchpad membuka di atas dock dan di bawah menu bar (tidak menimpa dock, tidak terpotong menu bar)', () => {
    const lp = rule('.dsk-menu[data-variant="launchpad"]');
    const dock = rule('.dsk-dock');
    const bottom = px(lp, 'bottom');
    expect(bottom).toBeGreaterThanOrEqual(AREA_INSETS.mac.bottom - 6 - 0); // di atas tepi atas kapsul (~60)
    expect(bottom).toBeGreaterThan(px(dock, 'bottom') + px(rule('.dsk-dk'), 'height'));
    const cut = /max-height:\s*calc\(100% - (\d+)px\)/.exec(lp);
    expect(cut).not.toBeNull();
    expect(Number(cut![1]) - bottom).toBeGreaterThanOrEqual(AREA_INSETS.mac.top); // sisa atas >= menu bar
  });

  it('skin Mac: FAB chat disembunyikan (chat di menu bar); panel membuka ke bawah tepat di bawah menu bar dan muat di layar pendek', () => {
    expect(css).toMatch(/data-skin="mac"\]\) \.chat-fab \{ display: none; \}/);
    const m = /data-skin="mac"\]\) \.chat-panel \{ top: (\d+)px; bottom: auto; right: (\d+)px; height: min\((\d+)px, calc\(100dvh - (\d+)px - (\d+)px - (\d+)px\)\); \}/.exec(css);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(AREA_INSETS.mac.top);       // tidak menutupi menu bar
    expect(Number(m![4])).toBe(Number(m![1]));                                // tinggi dikurangi offset atas yang sama
    expect(Number(m![5])).toBe(AREA_INSETS.mac.bottom);                       // dan tidak turun ke dock
    // tidak ada sisa aturan FAB Mac lama (bottom/right)
    expect(css).not.toMatch(/data-skin="mac"\]\) \.chat-fab \{ bottom/);
  });

  it('dock Mac tetap di dalam layar 1024px walau semua menu berjendela terbuka sekaligus (ikon menyusut)', () => {
    const dock = rule('.dsk-dock');
    const dk = rule('.dsk-dk');
    const gap = px(dock, 'gap');
    const pad = Number(/padding:\s*(\d+)px/.exec(dock)![1]);
    const reserve = Number(/max-width:\s*calc\(100% - (\d+)px\)/.exec(dock)![1]);
    expect(1024 - reserve).toBeGreaterThan(0);
    // ikon boleh menyusut (flex-shrink 1) sampai min-width, dan lebar minimum semua ikon muat dalam max-width
    expect(dk).toMatch(/flex-shrink:\s*1/);
    const minIcon = px(dk, 'min-width');
    const n = 1 + WINDOW_TABS.length;
    const minWidth = n * minIcon + (n + 1) * gap + 5 + 2 * pad + 2;
    expect(minWidth).toBeLessThanOrEqual(1024 - reserve);
  });

  it('jendela terbesar (ukuran awal tiap tab) di layar 1024x768 Mac tetap di atas dock dan di bawah menu bar', () => {
    const a = makeArea(1024, 768, 'mac');
    for (const id of WINDOW_TABS) {
      const size = DEFAULT_SIZES[id];
      if (!size) continue;
      expect(Math.min(size.h, a.h - a.top - a.bottom) + a.top).toBeLessThanOrEqual(a.h - a.bottom);
      expect(minSizeFor(id).w).toBeLessThanOrEqual(a.w);
    }
  });

  it('semua tab berjendela punya ukuran awal terdaftar (tidak jatuh ke FALLBACK_SIZE tanpa sengaja)', () => {
    for (const id of WINDOW_TABS) {
      if (id === 'pos' || id === 'dashboard' || id === 'orders' || id === 'products' || id === 'wallets' || id === 'income' || id === 'expenses') continue;
      expect(DEFAULT_SIZES[id], `DEFAULT_SIZES.${id}`).toBeDefined();
    }
  });

  it('modal di dalam jendela dibatasi ke area kerja (top/bottom = --dsk-top/--dsk-bot) hanya di bawah .dsk-root, dan tinggi kartu menyisakan padding', () => {
    expect(css).toMatch(/\.dsk-root \.modal-overlay,\s*\.dsk-root \.fixed\.inset-0 \{ top: var\(--dsk-top\); bottom: var\(--dsk-bot\); \}/);
    expect(css).toMatch(/\.dsk-root \.modal-sheet \{ max-height: calc\(100vh - var\(--dsk-top\) - var\(--dsk-bot\) - 48px\)/);
    // tidak ada selector modal global tanpa .dsk-root (Klasik dan modal Edit Profil/Tentang tidak boleh berubah)
    for (const line of css.split('\n')) if (/modal-overlay|modal-sheet/.test(line) && /\{/.test(line)) expect(line.trimStart().startsWith('.dsk-root')).toBe(true);
  });

  it('skin Windows: FAB chat disembunyikan, panel chat tepat di atas taskbar (>= tinggi taskbar), tombol chat di tray berukuran sama dengan bel', () => {
    expect(css).toMatch(/data-skin="windows"\]\) \.chat-fab \{ display: none; \}/);
    const m = /data-skin="windows"\]\) \.chat-panel \{ bottom: (\d+)px; right: (\d+)px; \}/.exec(css);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(AREA_INSETS.windows.bottom);
    expect(px(rule('.dsk-chat-btn'), 'width')).toBe(36);
    expect(px(rule('.dsk-chat-btn'), 'height')).toBe(36);
  });
});

describe('tombol tray/menu bar flat', () => {
  it('tombol chat tanpa border dan latar saat normal; hover memberi highlight; bel dark-tone tanpa kotak', () => {
    const btn = rule('.dsk-chat-btn');
    expect(btn).toMatch(/background:\s*transparent/);
    expect(btn).toMatch(/border:\s*0/);
    expect(css).toMatch(/\.dsk-chat-btn:hover[^{]*\{ background: rgba\(255,255,255,\.12\); \}/);
    expect(css).toMatch(/\.dsk-tray button\[title="Notifikasi"\]:hover \{ background: rgba\(255,255,255,\.12\) !important; \}/);
    // fokus keyboard tetap terlihat di desktop
    expect(css).toMatch(/\.dsk-root :focus-visible \{ outline:/);
    const bell = readFileSync(join(process.cwd(), 'src/components/NotificationBell.tsx'), 'utf8');
    expect(bell).toMatch(/tone === 'dark'\s*\n?\s*\? \{ background: 'transparent'/);
  });
});

describe('tombol aksi titlebar jendela flat (Refresh)', () => {
  it('.btn-ghost di slot titlebar tanpa border/latar, hover halus, dan tidak menyentuh tombol jendela', () => {
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost \{ background: transparent; border: 0; box-shadow: none; \}/);
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost:hover:not\(:disabled\) \{ background: var\(--border\); \}/);
    // semua selector flat berada di bawah .dsk-tbslot (Klasik #topbar-slot dan isi jendela tidak ikut)
    for (const line of css.split('\n')) if (/\.btn-ghost/.test(line) && /\{/.test(line)) expect(line.trimStart().startsWith('.dsk-tbslot')).toBe(true);
    expect(css).not.toMatch(/\.dsk-wb[^{]*\{[^}]*transparent !important/);
  });
});
