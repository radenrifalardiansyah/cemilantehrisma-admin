import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/components/desktop/desktop.css'), 'utf8');
const rule = (selector: string) => { const i = css.indexOf(selector + ' {'); expect(i, selector).toBeGreaterThan(-1); return css.slice(i, css.indexOf('}', i)); };

describe('CSS menu Mulai (Disematkan) dan menu di menu bar Mac', () => {
  it('panel Mulai tetap berukuran tetap (height min(...), bukan max-height); grid Disematkan 6 kolom dengan tinggi baris tetap', () => {
    const r = rule('.dsk-menu[data-variant="start"]');
    expect(r).toMatch(/[\s;{]height:\s*min\(/);
    expect(r).not.toMatch(/max-height/);
    expect(rule('.dsk-pgrid')).toMatch(/repeat\(6,/);
    expect(rule('.dsk-pgrid')).toMatch(/grid-auto-rows:\s*\d+px/);
  });
  it('bintang ubin tampil saat hover/fokus (bukan hanya hover)', () => {
    expect(css).toMatch(/\.dsk-pt:focus-within \.dsk-pstar/);
  });
  it('dropdown menu bar: di bawah bar, tanpa backdrop-filter/transform (acuan position:fixed modal tidak berpindah), z-index di atas jendela', () => {
    for (const sel of ['.dsk-mmenus', '.dsk-mwrap', '.dsk-mdrop', '.dsk-mtrig']) expect(rule(sel)).not.toMatch(/backdrop-filter|transform|filter:|contain:/);
    expect(rule('.dsk-mdrop')).toMatch(/top:\s*100%/);
    expect(Number(/z-index:\s*(\d+)/.exec(rule('.dsk-mdrop'))![1])).toBeGreaterThanOrEqual(5000);
    expect(rule('.dsk-mdrop')).toMatch(/overflow-y:\s*auto/);
  });
  // Lebar kolom nyata (setelah auto-fill) harus memuat label terpanjang tanpa ellipsis: bintang(32) + ikon(22) + gap(8) + padding kanan(9) + teks.
  const LONGEST = 'Laporan Penjualan per Kasir Lapak'; // acuan konservatif (33 huruf); label terpanjang nyata saat ini 'Laporan Penjualan per Kasir' = 27 huruf
  const NEED = 32 + 22 + 8 + 9 + Math.round(LONGEST.length * 6.2); // ~6.2px/huruf pada 12px/600
  it.each([['start', 600], ['launchpad', 900]] as const)('panel %s (%i px): kolom Semua menu memuat label terpanjang satu baris', (variant, maxW) => {
    const r = rule(`.dsk-menu[data-variant="${variant}"]`);
    expect(Number(/width:\s*min\((\d+)px/.exec(r)![1])).toBe(maxW);
    const min = Number(/minmax\((\d+)px/.exec(rule('.dsk-mitems'))![1]);
    const inner = maxW - 2 - 24; // border + padding .dsk-mscroll
    const cols = Math.floor((inner + 6) / (min + 6));
    const colW = (inner - (cols - 1) * 6) / cols;
    expect(cols).toBeGreaterThanOrEqual(2);
    expect(colW).toBeGreaterThanOrEqual(NEED);
  });
  it('panel Mulai muat di layar 1024 (lebar + left 8px); label membungkus maks. 2 baris sebagai pengaman', () => {
    const r = rule('.dsk-menu[data-variant="start"]');
    const width = Number(/width:\s*min\((\d+)px/.exec(r)![1]);
    const left = Number(/[\s;{]left:\s*(\d+)px/.exec(r)![1]);
    expect(width + left).toBeLessThanOrEqual(1024);   // lebar panel Mulai dari CSS + jarak kiri harus muat di layar minimum desktop (lg)
    expect(rule('.dsk-mi .lbl')).toMatch(/-webkit-line-clamp:\s*2/);
    expect(rule('.dsk-mi .lbl')).not.toMatch(/white-space:\s*nowrap/);
  });
});
