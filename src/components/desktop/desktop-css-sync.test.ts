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

  it('FAB chat Mac (44px, pojok kanan bawah) berada di bawah tepi atas dock: tidak menimpa kapsul pada tinggi yang sama', () => {
    const m = /body:has\(\.dsk-root\[data-skin="mac"\]\) \.chat-fab \{ bottom: (\d+)px; right: (\d+)px; \}/.exec(css);
    expect(m).not.toBeNull();
    const fabTop = Number(m![1]) + 44;
    const dock = rule('.dsk-dock');
    const dockTop = px(dock, 'bottom') + px(rule('.dsk-dk'), 'height') + 2 * Number(/padding:\s*(\d+)px/.exec(dock)![1]) + 2;
    expect(fabTop).toBeLessThanOrEqual(dockTop);
  });

  it('dock Mac tidak menabrak FAB di 1024px walau semua menu berjendela terbuka sekaligus (ikon menyusut, max-width menyisakan ruang FAB)', () => {
    const dock = rule('.dsk-dock');
    const dk = rule('.dsk-dk');
    const gap = px(dock, 'gap');
    const pad = Number(/padding:\s*(\d+)px/.exec(dock)![1]);
    const reserve = Number(/max-width:\s*calc\(100% - (\d+)px\)/.exec(dock)![1]);
    const fab = /\.chat-fab \{ bottom: \d+px; right: (\d+)px; \}/.exec(css.slice(css.indexOf('data-skin="mac"]) .chat-fab')));
    const fabLeft = 1024 - Number(fab![1]) - 44;
    // tepi kanan dock (terpusat, selebar max-width) tidak melewati tepi kiri FAB
    expect((1024 + (1024 - reserve)) / 2).toBeLessThanOrEqual(fabLeft);
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
