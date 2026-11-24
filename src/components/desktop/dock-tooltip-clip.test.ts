import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'src/components/desktop');
const css = readFileSync(join(dir, 'desktop.css'), 'utf8');
const dockTsx = readFileSync(join(dir, 'Dock.tsx'), 'utf8');

const rule = (selector: string) => {
  const i = css.indexOf(selector + ' {');
  expect(i, `selector ${selector} tidak ditemukan`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};
const num = (decl: string, re: RegExp) => { const m = re.exec(decl); expect(m, `pola ${re} tidak ditemukan`).not.toBeNull(); return Number(m![1]); };

// .dsk-dock-scroll ber-overflow-y:hidden sehingga memotong apa pun di atas padding-top-nya. Efek membesar (Dock.tsx, skala 1 + 0.45 saat kursor di atas ikon)
// ikut membesarkan tooltip (.tip adalah anak .dsk-dk). Tinggi ruang di atas garis dasar ikon = padding-top + tinggi ikon; harus memuat ikon+tooltip yang terskala.
describe('dock Mac: tooltip dan efek membesar tidak terpotong overflow wadah gulir', () => {
  it('padding-top wadah gulir cukup untuk ikon + tooltip pada skala membesar maksimum', () => {
    const scroll = rule('.dsk-dock-scroll');
    const dk = rule('.dsk-dk');
    const tip = rule('.dsk-dk .tip');
    const maxScale = 1 + num(dockTsx, /1 \+ ([\d.]+) \* Math\.max/);
    const icon = num(dk, /(?:^|[\s;{])height:\s*(\d+)px/);
    const gap = num(tip, /bottom:\s*calc\(100% \+ (\d+)px\)/);
    const fontSize = num(tip, /font-size:\s*(\d+)px/);
    const tipHeight = Math.ceil(fontSize * 1.2) + 2 * num(tip, /padding:\s*(\d+)px/);   // perkiraan konservatif (terukur di Chrome: 22px)
    const padTop = num(scroll, /padding:\s*(\d+)px/);
    const needed = Math.ceil((icon + gap + tipHeight) * maxScale);   // jarak puncak tooltip dari garis dasar ikon
    expect(padTop + icon, `tooltip terskala butuh ${needed}px di atas garis dasar, tersedia ${padTop + icon}px`).toBeGreaterThanOrEqual(needed);
  });
});
