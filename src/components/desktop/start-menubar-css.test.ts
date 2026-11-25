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
});
