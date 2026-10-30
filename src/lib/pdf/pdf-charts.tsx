import { Svg, G, Rect, Line, Polyline, Path, Circle, Text as SvgText, View, Text } from '@react-pdf/renderer';

// Grafik sederhana untuk PDF (react-pdf Svg) — tanpa Recharts karena PDF dirender di luar DOM.

const MUTED = '#A08468';
const GRID = '#E6DDD0';

export const compactRp = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${+(abs / 1_000_000_000).toFixed(1)} M`;
  if (abs >= 1_000_000) return `${sign}${+(abs / 1_000_000).toFixed(1)} jt`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} rb`;
  return `${sign}${Math.round(abs)}`;
};

// Pembulatan batas atas sumbu Y ke angka "bulat" (1/2/5 × 10^n) supaya gridline rapi.
const niceCeil = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

export interface LineSeries { name: string; color: string; values: number[]; fill?: boolean }

export function PdfLineChart({ labels, series, width = 523, height = 150 }: {
  labels: string[]; series: LineSeries[]; width?: number; height?: number;
}) {
  const n = labels.length;
  if (n === 0) return null;
  const padL = 42, padR = 8, padT = 8, padB = 20;
  const w = width - padL - padR, h = height - padT - padB;
  const all = series.flatMap(s => s.values);
  const rawMax = Math.max(0, ...all), rawMin = Math.min(0, ...all);
  const yMax = niceCeil(rawMax);
  const yMin = rawMin < 0 ? -niceCeil(-rawMin) : 0;
  const span = yMax - yMin || 1;
  const x = (i: number) => padL + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => padT + h - ((v - yMin) / span) * h;
  const ticks = [0, 1, 2, 3, 4].map(i => yMin + (span * i) / 4);
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  return (
    <Svg width={width} height={height}>
      {ticks.map((t, i) => (
        <Line key={i} x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={0.6} strokeDasharray="2 2" />
      ))}
      {ticks.map((t, i) => (
        <SvgText key={i} x={padL - 4} y={y(t) + 2.5} textAnchor="end" style={{ fontSize: 6.5 }} fill={MUTED}>{compactRp(t)}</SvgText>
      ))}
      {series.map(s => {
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        const area = s.fill && n > 1
          ? `M ${x(0)} ${y(0)} ${s.values.map((v, i) => `L ${x(i)} ${y(v)}`).join(' ')} L ${x(n - 1)} ${y(0)} Z`
          : null;
        return (
          <G key={s.name}>
            {area && <Path d={area} fill={s.color} fillOpacity={0.12} />}
            {n > 1 && <Polyline points={pts} stroke={s.color} strokeWidth={1.4} fill="none" />}
            {n <= 31 && s.values.map((v, i) => <Circle key={i} cx={x(i)} cy={y(v)} r={n === 1 ? 3 : 1.6} fill={s.color} />)}
          </G>
        );
      })}
      {labels.map((l, i) => ((i % labelEvery === 0 && (n - 1 - i >= labelEvery / 2 || i === n - 1)) || i === n - 1) && (
        <SvgText key={i} x={x(i)} y={height - 6} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
          style={{ fontSize: 6.5 }} fill={MUTED}>{l}</SvgText>
      ))}
    </Svg>
  );
}

export function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
      {items.map(it => (
        <View key={it.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: it.color }} />
          <Text style={{ fontSize: 7, color: MUTED }}>{it.name}</Text>
        </View>
      ))}
    </View>
  );
}

export interface BarItem { label: string; value: number; color: string; valueText: string }

// Bar horizontal — panjang bar proporsional terhadap nilai absolut terbesar.
export function PdfHBarChart({ items, width = 250, labelW = 78, valueW = 70, rowH = 16 }: {
  items: BarItem[]; width?: number; labelW?: number; valueW?: number; rowH?: number;
}) {
  const max = Math.max(1, ...items.map(i => Math.abs(i.value)));
  const barW = width - labelW - valueW;
  return (
    <Svg width={width} height={items.length * rowH}>
      {items.map((it, i) => {
        const len = Math.max(it.value === 0 ? 0 : 1.5, (Math.abs(it.value) / max) * barW);
        const cy = i * rowH + rowH / 2;
        return (
          <G key={it.label}>
            <SvgText x={0} y={cy + 2.5} style={{ fontSize: 7.5 }} fill="#1E1008">{it.label}</SvgText>
            <Rect x={labelW} y={cy - 4.5} width={barW} height={9} rx={2} fill="#F3EEE6" />
            <Rect x={labelW} y={cy - 4.5} width={len} height={9} rx={2} fill={it.color} />
            <SvgText x={width} y={cy + 2.5} textAnchor="end" style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold' }} fill={it.color}>{it.valueText}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
