import type { WallpaperId } from '@/lib/appearance';

// Latar desktop: ilustrasi vektor SVG (data URI) + gradasi CSS. Tanpa foto, tanpa jaringan, bebas lisensi.
// Dipakai sebagai nilai CSS `background` untuk latar penuh DAN thumbnail 296x166 (viewBox 16:9, slice = cover).
// Semua latar sengaja gelap/redup, terutama sisi kiri (tempat ikon meja) dan bawah (taskbar), supaya teks putih terbaca.
// `accent` hanya diterima bila hex valid (#RGB/#RRGGBB); semua warna dalam SVG dihitung dari hex ter-parse,
// input mentah tidak pernah disisipkan ke SVG.

export const DEFAULT_WALLPAPER_ACCENT = '#D4691E';
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalisasi hex ke '#rrggbb' huruf kecil; null bila tidak valid. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!HEX_RE.test(s)) return null;
  const h = s.slice(1).toLowerCase();
  return '#' + (h.length === 3 ? h.split('').map(c => c + c).join('') : h);
}

const rgb = (c: string): [number, number, number] => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (v: number[]) => '#' + v.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return toHex(x.map((n, i) => n + (y[i] - n) * t)); };

interface Pal { a: string; d: (t: number) => string; l: (t: number) => string }
const palette = (accent?: string): Pal => {
  const a = normalizeHex(accent) ?? normalizeHex(DEFAULT_WALLPAPER_ACCENT)!;
  return { a, d: t => mix('#0d0704', a, t), l: t => mix(a, '#ffffff', t) };
};

// Acak deterministik (mulberry32) supaya output stabil antar render/SSR.
const rng = (seed: number) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r0 = (n: number) => Math.round(n);

const W = 1600, H = 900;

// Pembungkus: skala konten, plus peredam kiri & bawah agar ikon meja/taskbar tetap kontras.
function svg(p: Pal, body: string, defs = ''): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'>`
    + `<defs>${defs}<linearGradient id='sl'><stop offset='0' stop-color='${p.d(0.04)}' stop-opacity='.7'/><stop offset='1' stop-color='${p.d(0.04)}' stop-opacity='0'/></linearGradient>`
    + `<linearGradient id='sb' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.4'/></linearGradient></defs>`
    + body
    + `<rect width='700' height='${H}' fill='url(#sl)'/><rect y='780' width='${W}' height='120' fill='url(#sb)'/></svg>`;
}

const bgRect = () => `<rect width='${W}' height='${H}' fill='url(#bg)'/>`;
const bgDef = (p: Pal, t0: number, t1: number, angle = 'x2=\'.3\' y2=\'1\'') =>
  `<linearGradient id='bg' x1='0' y1='0' ${angle}><stop offset='0' stop-color='${p.d(t0)}'/><stop offset='1' stop-color='${p.d(t1)}'/></linearGradient>`;

// ---- 9 latar ----

function waves(p: Pal): string {
  let body = bgRect();
  for (let i = 0; i < 5; i++) {
    const y = 430 + i * 85, k = 38 + i * 9, o = (0.07 + i * 0.045).toFixed(2);
    const d = `M0 ${y}C300 ${y - k} 600 ${y + k} 900 ${y}S1400 ${y - k} 1600 ${y + k / 2}V${H}H0z`;
    body += `<path d='${d}' fill='${p.l(0.15)}' fill-opacity='${o}'/><path d='M0 ${y}C300 ${y - k} 600 ${y + k} 900 ${y}S1400 ${y - k} 1600 ${y + k / 2}' fill='none' stroke='${p.l(0.45)}' stroke-opacity='.22' stroke-width='1.5'/>`;
  }
  return svg(p, body, bgDef(p, 0.26, 0.08));
}

function network(p: Pal): string {
  const rnd = rng(7);
  const pts: [number, number][] = [];
  while (pts.length < 24) {
    const x = r0(380 + rnd() * 1250), y = r0(40 + rnd() * 780);
    if (pts.every(([a, b]) => Math.hypot(a - x, b - y) > 130)) pts.push([x, y]);
  }
  let lines = '';
  pts.forEach(([x, y], i) => pts.slice(i + 1).forEach(([a, b]) => { if (Math.hypot(a - x, b - y) < 300) lines += `M${x} ${y}L${a} ${b}`; }));
  const dots = `<g fill='${p.l(0.25)}' fill-opacity='.75'>` + pts.map(([x, y], i) => `<circle cx='${x}' cy='${y}' r='${i % 4 ? 3.5 : 6}'/>`).join('') + '</g>';
  const glow = `<radialGradient id='gl' cx='.72' cy='.4' r='.5'><stop offset='0' stop-color='${p.a}' stop-opacity='.3'/><stop offset='1' stop-color='${p.a}' stop-opacity='0'/></radialGradient>`;
  const body = bgRect() + `<rect width='${W}' height='${H}' fill='url(#gl)'/><path d='${lines}' stroke='${p.l(0.2)}' stroke-opacity='.26' stroke-width='1.2' fill='none'/>${dots}`;
  return svg(p, body, bgDef(p, 0.16, 0.06) + glow);
}

function geometric(p: Pal): string {
  const pat = `<pattern id='tr' width='120' height='104' patternUnits='userSpaceOnUse'><path d='M0 0L60 104L120 0M0 104H120M-60 104L0 0M60 0L120 104' stroke='${p.l(0.3)}' stroke-opacity='.13' fill='none'/></pattern>`
    + `<linearGradient id='fd' x1='0' x2='1'><stop offset='0' stop-opacity='1'/><stop offset='.9' stop-opacity='.2'/></linearGradient>`;
  const body = bgRect() + `<rect width='${W}' height='${H}' fill='url(#tr)'/>`
    + `<g fill='${p.l(0.1)}'><path d='M1000 120L1180 430L820 430z' fill-opacity='.13'/><path d='M1260 430L1440 740L1080 740z' fill-opacity='.1'/><path d='M1180 430L1360 120L1520 430z' fill-opacity='.08'/><path d='M720 430L900 740L540 740z' fill-opacity='.06'/></g>`
    + `<g fill='none' stroke='${p.l(0.45)}' stroke-opacity='.3' stroke-width='1.5'><path d='M1000 120L1180 430L820 430z'/><path d='M1260 430L1440 740L1080 740z'/><path d='M1180 430L1360 120L1520 430z'/></g>`;
  return svg(p, body, bgDef(p, 0.2, 0.06) + pat);
}

function ridge(rnd: () => number, base: number, amp: number, n: number): string {
  let d = `M0 ${H}V${r0(base - rnd() * amp)}`;
  for (let i = 1; i <= n; i++) d += `L${r0(i * W / n)} ${r0(base - rnd() * amp)}`;
  return d + `V${H}z`;
}
function nature(p: Pal): string {
  const rnd = rng(21);
  const sky = `<linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${p.d(0.08)}'/><stop offset='.7' stop-color='${p.d(0.38)}'/><stop offset='1' stop-color='${p.d(0.3)}'/></linearGradient>`
    + `<radialGradient id='sn' cx='.5' cy='.5' r='.5'><stop offset='0' stop-color='${p.l(0.35)}' stop-opacity='.55'/><stop offset='1' stop-color='${p.a}' stop-opacity='0'/></radialGradient>`;
  const stars = Array.from({ length: 16 }, () => `<circle cx='${r0(500 + rnd() * 1100)}' cy='${r0(20 + rnd() * 260)}' r='${(0.8 + rnd()).toFixed(1)}'/>`).join('');
  const body = bgRect()
    + `<g fill='${p.l(0.7)}' fill-opacity='.5'>${stars}</g>`
    + `<circle cx='1220' cy='300' r='230' fill='url(#sn)'/><circle cx='1220' cy='300' r='62' fill='${p.l(0.45)}' fill-opacity='.8'/>`
    + `<path d='${ridge(rnd, 600, 190, 11)}' fill='${p.d(0.3)}'/>`
    + `<path d='${ridge(rnd, 680, 140, 13)}' fill='${p.d(0.22)}'/>`
    + `<path d='${ridge(rnd, 760, 90, 15)}' fill='${p.d(0.15)}'/>`
    + `<path d='${ridge(rnd, 840, 50, 18)}' fill='${p.d(0.09)}'/>`;
  return svg(p, body, sky);
}

function city(p: Pal): string {
  const rnd = rng(33);
  const layer = (minH: number, maxH: number, lit: number) => {
    let shape = '', win = '';
    for (let x = -10; x < W;) {
      const w = r0(54 + rnd() * 56), h = r0(minH + rnd() * (maxH - minH) * (0.45 + 0.55 * x / W)), y = H - h;
      shape += `M${x} ${H}V${y}h${w}V${H}z`;
      if (lit) for (let wy = y + 24; wy < H - 90; wy += 34) for (let wx = x + 12; wx < x + w - 14; wx += 22) if (rnd() < lit) win += `M${wx} ${wy}h8v12h-8z`;
      x += w + r0(rnd() * 8);
    }
    return { shape, win };
  };
  const back = layer(200, 520, 0), front = layer(120, 400, 0.1);
  const sky = `<linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${p.d(0.06)}'/><stop offset='.75' stop-color='${p.d(0.42)}'/><stop offset='1' stop-color='${p.d(0.3)}'/></linearGradient>`;
  const body = bgRect()
    + `<path d='${back.shape}' fill='${p.d(0.24)}'/>`
    + `<path d='${front.shape}' fill='${p.d(0.1)}'/>`
    + `<path d='${front.win}' fill='${p.l(0.4)}' fill-opacity='.8'/>`;
  return svg(p, body, sky);
}

function architecture(p: Pal): string {
  const s = `stroke='${p.l(0.4)}' stroke-opacity='.4' fill='none' stroke-width='1.5'`;
  const grid = `<pattern id='gr' width='48' height='48' patternUnits='userSpaceOnUse'><path d='M48 0H0V48' stroke='${p.l(0.4)}' stroke-opacity='.07' fill='none'/></pattern>`;
  let win = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) win += `M${690 + c * 74} ${190 + r * 98}h46v62h-46z`;
  const body = bgRect() + `<rect width='${W}' height='${H}' fill='url(#gr)'/>`
    + `<g ${s}><path d='M660 130H1170V690H660zM640 690H1190M690 130V90H1140V130'/><path d='${win}' stroke-opacity='.3'/>`
    + `<path d='M900 690V640h-50v50M1260 690V270H1480V690M1260 270L1370 190L1480 270M1260 480H1480M1340 690V560h60v130'/>`
    + `<path d='M660 760H1170M660 750V770M1170 750V770M1230 270H1500M1230 260V280M1500 260V280' stroke-dasharray='6 5'/>`
    + `<path d='M1060 690A50 50 0 0 0 1010 640' stroke-opacity='.3'/><circle cx='415' cy='640' r='80' stroke-opacity='.25'/><path d='M335 640H495M415 560V720' stroke-opacity='.2' stroke-dasharray='10 6'/></g>`;
  return svg(p, body, bgDef(p, 0.17, 0.07) + grid);
}

function office(p: Pal): string {
  const wm = Array.from({ length: 3 }, (_, i) => `M${870 + i * 170} 150V520`).join('') + 'M700 335H1380';
  const body = bgRect()
    + `<rect x='700' y='130' width='680' height='410' rx='6' fill='url(#wn)' stroke='${p.l(0.35)}' stroke-opacity='.4' stroke-width='6'/>`
    + `<path d='${wm}' stroke='${p.l(0.35)}' stroke-opacity='.4' stroke-width='5'/>`
    + `<circle cx='1180' cy='260' r='42' fill='${p.l(0.5)}' fill-opacity='.35'/>`
    + `<rect y='700' width='${W}' height='200' fill='${p.d(0.06)}'/>`
    // meja, monitor, lampu
    + `<rect x='640' y='640' width='800' height='22' rx='4' fill='${p.d(0.3)}'/><path d='M680 662V860M1400 662V860' stroke='${p.d(0.3)}' stroke-width='16'/>`
    + `<rect x='900' y='490' width='230' height='140' rx='8' fill='${p.d(0.1)}' stroke='${p.l(0.3)}' stroke-opacity='.4' stroke-width='3'/><path d='M1015 630V640M960 640H1070' stroke='${p.l(0.3)}' stroke-opacity='.4' stroke-width='6'/>`
    + `<path d='M1300 640V540L1250 500' stroke='${p.l(0.3)}' stroke-opacity='.5' stroke-width='6' fill='none'/><path d='M1225 485L1275 515L1260 540L1215 510z' fill='${p.l(0.45)}' fill-opacity='.5'/>`
    // rak & tanaman
    + `<path d='M1470 300H1590M1470 400H1590' stroke='${p.d(0.3)}' stroke-width='10'/><rect x='1500' y='340' width='26' height='60' fill='${p.l(0.2)}' fill-opacity='.3'/><rect x='1540' y='350' width='24' height='50' fill='${p.l(0.1)}' fill-opacity='.25'/>`
    + `<path d='M1480 640H1560L1550 740H1490z' fill='${p.d(0.35)}'/><g fill='${p.l(0.05)}' fill-opacity='.38'><ellipse cx='1500' cy='590' rx='14' ry='46' transform='rotate(-25 1500 590)'/><ellipse cx='1540' cy='580' rx='14' ry='52' transform='rotate(22 1540 580)'/><ellipse cx='1520' cy='560' rx='13' ry='50'/></g>`;
  const defs = bgDef(p, 0.2, 0.08)
    + `<linearGradient id='wn' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${p.d(0.2)}'/><stop offset='1' stop-color='${p.l(0.1)}' stop-opacity='.35'/></linearGradient>`;
  return svg(p, body, defs);
}

function team(p: Pal): string {
  const person = `<g id='pp'><circle cy='-62' r='24'/><path d='M-46 40V6a46 40 0 0 1 92 0V40z'/></g>`;
  const people: [number, number, number, number][] = [
    [1040, 600, 1.5, 0.5], [1250, 590, 1.6, 0.45], [1450, 610, 1.4, 0.38],
    [930, 700, 1.25, 0.32], [1145, 700, 1.3, 0.62], [1350, 705, 1.3, 0.34], [1540, 720, 1.1, 0.28],
  ];
  const use = people.map(([x, y, sc, o]) => `<use href='#pp' transform='translate(${x} ${y}) scale(${sc})' fill='${p.l(0.3)}' fill-opacity='${o}'/>`).join('');
  const body = bgRect()
    + `<circle cx='1180' cy='470' r='330' fill='${p.a}' fill-opacity='.14'/><circle cx='1180' cy='470' r='220' fill='${p.a}' fill-opacity='.14'/>`
    + `<circle cx='1180' cy='470' r='330' fill='none' stroke='${p.l(0.4)}' stroke-opacity='.2' stroke-dasharray='4 8'/>`
    + `<g fill='${p.l(0.4)}' fill-opacity='.4'><circle cx='980' cy='250' r='7'/><circle cx='1420' cy='330' r='5'/><circle cx='1300' cy='180' r='6'/><circle cx='860' cy='440' r='4'/></g>`
    + use;
  return svg(p, body, bgDef(p, 0.24, 0.07, "x2='.2' y2='1'") + person);
}

function gradient(accent?: string): string {
  const a = normalizeHex(accent);
  if (!a || a === DEFAULT_WALLPAPER_ACCENT.toLowerCase()) {
    // Identik dengan latar Windows bawaan di desktop.css.
    return 'radial-gradient(900px 500px at 78% 8%, rgba(240,138,60,.38), transparent 60%), radial-gradient(700px 480px at 6% 96%, rgba(212,105,30,.28), transparent 62%), linear-gradient(160deg, #3A1F10 0%, #24120A 55%, #1A0D06 100%)';
  }
  const p = palette(a), [r, g, b] = rgb(p.l(0.12)), [r2, g2, b2] = rgb(a);
  return `radial-gradient(900px 500px at 78% 8%, rgba(${r},${g},${b},.38), transparent 60%), radial-gradient(700px 480px at 6% 96%, rgba(${r2},${g2},${b2},.28), transparent 62%), linear-gradient(160deg, ${p.d(0.22)} 0%, ${p.d(0.13)} 55%, ${p.d(0.08)} 100%)`;
}

const ART: Record<Exclude<WallpaperId, 'gradient'>, (p: Pal) => string> = {
  waves, network, geometric, nature, city, architecture, office, team,
};

// Escape minimum yang aman untuk url("...") berkutip ganda: SVG memakai kutip tunggal, jadi cukup % # < >.
const encodeSvg = (s: string) => s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E');

// Mengembalikan nilai CSS `background` (shorthand lengkap, termasuk size/position) untuk latar desktop dan thumbnail.
export function wallpaperBackground(id: WallpaperId, accent?: string): string {
  if (id === 'gradient') return gradient(accent);
  const draw = ART[id];
  const p = palette(accent);
  if (!draw) return gradient(accent);
  return `url("data:image/svg+xml,${encodeSvg(draw(p))}") center / cover no-repeat, ${p.d(0.1)}`;
}
