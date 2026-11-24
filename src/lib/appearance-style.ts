import { ACCENT_META, type Appearance } from '@/lib/appearance';
import { hexToShades } from '@/lib/color';
import { wallpaperBackground } from '@/lib/wallpapers';

// Gaya inline yang HANYA dipasang pada .dsk-root (dan pembungkus dialog Tampilan), sehingga tidak bocor ke Klasik.
// 'brand' = tanpa override (memakai variabel aksen bawaan/branding); 'gradient' = tanpa override (latar default skin).
const hex2rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (h: string, t: string, p: number) => {
  const a = hex2rgb(h), b = hex2rgb(t);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * p).toString(16).padStart(2, '0')).join('');
};

// Turunan aksen: sama pola dengan layout.tsx (hexToShades), plus border dan gradien tombol. Semua swatch cukup gelap
// sehingga teks putih di atas aksen/gradiennya tetap terbaca (>= 4.5:1).
export function accentVars(hex: string): Record<string, string> {
  const s = hexToShades(hex);
  const [r, g, b] = hex2rgb(hex);
  return {
    '--accent': s.accent, '--accent-dark': s.dark, '--accent-light': s.light, '--accent-bg': s.bg,
    '--accent-border': `rgba(${r},${g},${b},0.2)`,
    '--accent-grad': `linear-gradient(135deg, ${mix(hex, '#FFFFFF', 0.1)}, ${mix(hex, '#000000', 0.1)})`,
    '--accent-grad-hover': `linear-gradient(135deg, ${hex}, ${mix(hex, '#000000', 0.18)})`,
  };
}

export function appearanceStyle(a: Appearance): Record<string, string> {
  const vars: Record<string, string> = {};
  if (a.accent !== 'brand') Object.assign(vars, accentVars(ACCENT_META[a.accent].swatch));
  if (a.wallpaper !== 'gradient') vars['--dsk-wallpaper'] = wallpaperBackground(a.wallpaper, ACCENT_META[a.accent].swatch);
  return vars;
}
