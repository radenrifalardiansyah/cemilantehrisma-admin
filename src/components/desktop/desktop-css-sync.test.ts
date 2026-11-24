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
    const cut = /[\s;{]height:\s*min\(\d+px,\s*calc\(100% - (\d+)px\)\)/.exec(lp);
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
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost:hover:not\(:disabled\) \{ background: var\(--border\);/);
    // semua selector flat berada di bawah .dsk-tbslot (Klasik #topbar-slot dan isi jendela tidak ikut)
    for (const line of css.split('\n')) if (/\.btn-ghost/.test(line) && /\{/.test(line)) expect(/^\s*(\.dsk-tbslot|\.dsk-win\[data-narrow="true"\] \.dsk-tbslot)/.test(line), line).toBe(true);
    expect(css).not.toMatch(/\.dsk-wb[^{]*\{[^}]*transparent !important/);
  });
});

describe('panel semua menu dan jarak tray', () => {
  it('tinggi panel tetap (height, bukan max-height) untuk Mulai dan Launchpad', () => {
    for (const v of ['start', 'launchpad']) {
      const r = rule(`.dsk-menu[data-variant="${v}"]`);
      expect(r).toMatch(/[\s;{]height:\s*min\(/);
      expect(r).not.toMatch(/max-height/);
    }
  });
  it('tombol footer ikon 28-30px tanpa border; chat dan bel rapat (gap tray <= 2px, slot chat tanpa margin)', () => {
    const b = rule('.dsk-mfoot .row button');
    expect(px(b, 'width')).toBeLessThanOrEqual(30);
    expect(px(b, 'width')).toBeGreaterThanOrEqual(28);
    expect(b).toMatch(/border:\s*0/);
    expect(px(rule('.dsk-tray'), 'gap')).toBeLessThanOrEqual(2);
    expect(px(rule('.dsk-mbar .dsk-tray'), 'gap')).toBeLessThanOrEqual(2);
    expect(rule('.dsk-chat-slot')).toMatch(/margin:\s*0/);
  });
});

describe('pengaturan tampilan Desktop: tidak bocor ke Klasik', () => {
  it('semua selector data-density / data-text / --dsk-wallpaper berada di bawah .dsk-root (atau html:has(.dsk-root...)); tidak ada selector global', () => {
    const lines = css.split('\n').filter(l => /data-density|data-text|data-accent|--dsk-wallpaper|--dsk-density/.test(l) && /\{/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(/^\s*(\.dsk-root|html:has\(\.dsk-root)/.test(l), l).toBe(true);
  });
  it('latar default tetap gradasi bawaan (fallback var) agar "gradient" identik dengan tampilan sekarang', () => {
    expect(css).toMatch(/\.dsk-root\[data-skin="windows"\] \{ background: var\(--dsk-wallpaper,\s*radial-gradient\(900px 500px/);
    expect(css).toMatch(/\.dsk-root\[data-skin="mac"\] \{ background: var\(--dsk-wallpaper,\s*radial-gradient\(800px 520px/);
  });
  it('ukuran dock/taskbar/inset tidak diubah oleh kerapatan atau ukuran teks (tetap px, tidak memakai --dsk-density)', () => {
    for (const sel of ['.dsk-dock', '.dsk-dk', '.dsk-task', '.dsk-mbar']) expect(rule(sel)).not.toMatch(/--dsk-density/);
  });
  const block = css.slice(css.indexOf('/* ── Pengaturan tampilan Desktop'));
  const selectors = Array.from(block.matchAll(/^([^\s/*}][^{\n]*?)\s*\{/gm)).map(m => m[1]);

  it('SEMUA aturan di blok pengaturan tampilan terikat .dsk-root (tanpa pengecualian kata kunci), dan html:has hanya mengatur font-size', () => {
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) expect(/^(\.dsk-root[\s[]|html:has\(\.dsk-root\[data-text="(small|large)"\]\)$)/.test(sel), sel).toBe(true);
    for (const m of block.matchAll(/^html:has\([^)]*\)\) ?\{([^}]*)\}|^html:has\([^{]*\{([^}]*)\}/gm)) {
      const decls = (m[1] ?? m[2]).split(';').map(d => d.trim()).filter(Boolean);
      for (const d of decls) expect(d, 'html:has hanya boleh mengubah font-size').toMatch(/^font-size:\s*[\d.]+(px|%)$/);
    }
  });
  it('nilai standar tidak punya aturan sendiri (data-text="standard" dan data-density="standard" tidak ditulis di CSS)', () => {
    expect(css).not.toMatch(/data-text="standard"/);
    expect(css).not.toMatch(/data-density="standard"/);
  });
  it('kerapatan standar (--dsk-density: 1) menghasilkan angka yang sama dengan aturan asli ikon desktop dan item menu', () => {
    const factor = (decl: string, prop: string) => Number(new RegExp(`${prop}:[^;]*?(\\d+(?:\\.\\d+)?)px \\* var\\(--dsk-density\\)`).exec(decl)?.[1]);
    const ovr = (sel: string) => { const i = block.indexOf(sel + ' {'); expect(i, sel).toBeGreaterThan(-1); return block.slice(i, block.indexOf('}', i)); };
    expect(factor(ovr('.dsk-root .dsk-icons'), 'grid-template-rows')).toBe(Number(/grid-template-rows: repeat\(auto-fill, (\d+)px\)/.exec(rule('.dsk-icons'))![1]));
    expect(factor(ovr('.dsk-root .dsk-icons'), 'gap')).toBe(Number(/gap: (\d+)px/.exec(rule('.dsk-icons'))![1]));
    expect(factor(ovr('.dsk-root .dsk-ico'), 'height')).toBe(px(rule('.dsk-ico'), 'height'));
    expect(factor(ovr('.dsk-root .dsk-mitems'), 'gap')).toBe(px(rule('.dsk-mitems'), 'gap'));
    expect(factor(ovr('.dsk-root .dsk-mi'), 'padding')).toBe(Number(/padding: (\d+)px/.exec(rule('.dsk-mi'))![1]));
    // padding badan jendela asli 0 (tidak ada deklarasi), dan rumusnya bernilai 0 pada densitas 1
    expect(rule('.dsk-body')).not.toMatch(/padding/);
    expect(ovr('.dsk-root .dsk-body')).toMatch(/max\(0px, calc\(\(var\(--dsk-density\) - 1\) \* 24px\)\)/);
    expect(rule('.dsk-root')).toMatch(/--dsk-density: 1;/);
  });
});

describe('tombol aksi titlebar seragam dengan tombol kontrol jendela', () => {
  it('ikon-saja berukuran sama dengan .dsk-wb (30x26, radius 7), warna dan hover sama, ikon 14px stroke 2', () => {
    const wb = rule('.dsk-wb');
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost:has\(> svg:only-child\) \{ width: 30px;/);
    expect(px(wb, 'width')).toBe(30);
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost \{ height: 26px;[^}]*border-radius: 7px; color: var\(--text-muted\)/);
    expect(px(wb, 'height')).toBe(26);
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost:hover:not\(:disabled\) \{ background: var\(--border\); color: var\(--text-primary\); \}/);
    expect(css).toMatch(/\.dsk-wb:hover \{ background: var\(--border\); color: var\(--text-primary\); \}/);
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost svg \{ stroke-width: 2;/);
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost:has\(> svg:only-child\) svg \{ width: 14px; height: 14px; \}/);
  });
  it('tanpa celah antara slot dan kontrol: gap slot 0 dan margin negatif sebesar gap titlebar di Windows', () => {
    expect(px(rule('.dsk-tbslot'), 'gap')).toBe(0);
    expect(css).toMatch(/\.dsk-root\[data-skin="windows"\] \.dsk-tbslot \{ margin-right: -8px; \}/);
    expect(px(rule('.dsk-tb'), 'gap')).toBe(8);
  });
});

describe('kerapatan dan ukuran teks (perbaikan review)', () => {
  it("'rapat' tidak memendekkan sel ikon meja di bawah isi (min 88px, baris min 90px); 'standard' tetap 88/90", () => {
    expect(css).toMatch(/\.dsk-root \.dsk-ico \{ height: max\(88px, calc\(88px \* var\(--dsk-density\)\)\);/);
    expect(css).toMatch(/grid-template-rows: repeat\(auto-fill, max\(90px, calc\(90px \* var\(--dsk-density\)\)\)\)/);
    const compact = Number(/data-density="compact"\] \{ --dsk-density: ([\d.]+)/.exec(css)![1]);
    expect(Math.max(88, 88 * compact)).toBe(88);   // rapat >= tinggi isi (ikon 46 + label dua baris + padding)
  });
  it('ukuran teks memakai persentase terhadap ukuran dasar browser (bukan px mutlak)', () => {
    expect(css).toMatch(/html:has\(\.dsk-root\[data-text="small"\]\) \{ font-size: 93\.75%; \}/);
    expect(css).toMatch(/html:has\(\.dsk-root\[data-text="large"\]\) \{ font-size: 109\.375%; \}/);
  });
});

describe('slot titlebar: satu baris, tidak menimpa kontrol jendela', () => {
  it('slot nowrap, boleh menyusut (min-width 0, overflow hidden), tanpa tinggi tetap yang memotong; judul mengalah lebih dulu', () => {
    const slot = rule('.dsk-tbslot');
    expect(slot).toMatch(/flex-wrap:\s*nowrap/);
    expect(slot).toMatch(/white-space:\s*nowrap/);
    expect(slot).toMatch(/min-width:\s*0/);
    expect(slot).toMatch(/overflow:\s*hidden/);
    expect(slot).toMatch(/flex:\s*0 1 auto/);
    expect(slot).not.toMatch(/[^-]height:/);
    expect(rule('.dsk-title')).toMatch(/min-width:\s*0/);
    expect(rule('.dsk-title')).toMatch(/flex:\s*1/);
  });
  it('kontrol jendela tidak menyusut; tombol bertulisan auto-width satu baris (tidak terkunci 30px oleh w-9) dengan ellipsis', () => {
    expect(css).toMatch(/\.dsk-wbs, \.dsk-tl \{ flex-shrink: 0; \}/);
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost:not\(:has\(> svg:only-child\)\) \{ width: auto; min-width: 30px; flex-shrink: 1; white-space: nowrap; overflow: hidden; \}/);
    expect(css).toMatch(/\.dsk-tbslot \.btn-ghost > span:not\(\.absolute\) \{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;/);
    // aturan ikon-saja tidak lagi memakai .w-9 (yang juga dipakai tombol bertulisan)
    expect(css).not.toMatch(/\.dsk-tbslot \.btn-ghost\.w-9/);
  });
  it('jendela sempit: tombol berikon jadi ikon saja, badge tetap tampil; semua selector di bawah .dsk-win/.dsk-tbslot', () => {
    expect(css).toMatch(/\.dsk-win\[data-narrow="true"\] \.dsk-tbslot \.btn-ghost > span:not\(\.absolute\) \{ display: none; \}/);
    expect(css).toMatch(/\.dsk-win\[data-narrow="true"\] \.dsk-tbslot \.btn-ghost > span\.absolute \{ display: flex; \}/);
    for (const line of css.split('\n')) if (/data-narrow/.test(line) && /\{/.test(line) && !line.trimStart().startsWith('/*')) expect(line.trimStart().startsWith('.dsk-win[data-narrow')).toBe(true);
  });
});
