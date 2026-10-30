import { Document, Page, Text, View, Image, StyleSheet, Svg, G, Line, Path, Circle, Rect } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

// PDF generik untuk semua halaman Analitik (Bisnis, Mitra, Lapak, Web): kop toko + kartu ringkasan
// + beberapa tabel (opsional dengan baris total). Teks harus Latin-1/WinAnsi (font Helvetica bawaan).
export interface AnalyticsPdfColumn { header: string; width: string; align?: 'left' | 'right' | 'center'; bold?: boolean }
export interface AnalyticsPdfSection {
  title: string;
  columns: AnalyticsPdfColumn[];
  rows: (string | number)[][];
  total?: (string | number)[];
  highlightRows?: number[];            // indeks baris yang diberi latar sorot (mis. bulan terbaik)
  emptyText?: string;
}
// Grafik yang digambar langsung (vektor) di PDF. 'line' = tren beberapa seri atas `labels`;
// 'bar' = peringkat horizontal (satu seri, `labels` = nama baris);
// 'vbar' = batang vertikal berkelompok per label (beberapa seri; bar tertinggi per seri dipekatkan, nilai negatif didukung).
export interface AnalyticsPdfChart {
  title: string;
  type: 'line' | 'bar' | 'vbar';
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  unit?: 'rp' | 'num' | 'pct';       // default 'rp'
}
export interface AnalyticsReportData {
  title: string;                       // mis. "ANALITIK MITRA"
  periodLabel: string;
  generatedAt: string;
  cards: { label: string; value: string }[];
  charts?: AnalyticsPdfChart[];
  sections: AnalyticsPdfSection[];
}

const C = {
  accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#A08468',
  border: '#E6DDD0', white: '#FFFFFF',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 32, paddingBottom: 44, fontSize: 9 },
  topBar: { height: 7, backgroundColor: C.accent, marginTop: -32, marginHorizontal: -32, marginBottom: 18 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 44, height: 44, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  storeName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  storeTagline: { fontSize: 8, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8, color: C.muted, marginTop: 1 },
  headerRight: { alignItems: 'flex-end', width: '42%', flexShrink: 0 },
  docTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5 },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  docMeta: { fontSize: 8, color: C.muted, marginTop: 3 },
  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 10, marginBottom: 12 },

  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  card: { width: '24%', flexGrow: 1, borderWidth: 1, borderColor: C.border, borderRadius: 6, padding: 7, backgroundColor: C.accentBg },
  cardLabel: { fontSize: 6.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardVal: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginTop: 3 },

  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.accent, marginBottom: 6, marginTop: 4 },
  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border, marginBottom: 14 },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 7, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 4 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tRowHi: { backgroundColor: '#FFF1BF', borderTopColor: '#E8C766' },
  tCell: { fontSize: 7.5, paddingVertical: 4.5, paddingHorizontal: 4 },
  tTotalRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.accentBg },
  tTotalCell: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 4 },
  empty: { fontSize: 8.5, color: C.muted, marginBottom: 14 },

  chartBox: { borderWidth: 1, borderColor: C.border, borderRadius: 6, padding: 8, marginBottom: 12 },
  chartTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  legend: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 7, color: C.muted },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  barLabel: { width: '30%', fontSize: 7.5, paddingRight: 6 },
  barTrack: { flexGrow: 1, height: 9, backgroundColor: '#F3ECE2', borderRadius: 3 },
  barFill: { height: 9, borderRadius: 3 },
  barValue: { width: '20%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', textAlign: 'right' },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: C.muted },
});

type Unit = 'rp' | 'num' | 'pct';
const fmtAxis = (n: number, unit: Unit) => {
  const a = Math.abs(n);
  if (unit === 'pct') return `${Math.round(n)}%`;
  if (unit === 'rp') {
    if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}jt`;
    if (a >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
    return String(Math.round(n));
  }
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n);
};
const fmtFull = (n: number, unit: Unit) => unit === 'pct' ? `${n}%` : unit === 'rp'
  ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
  : new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n);

// Batas atas sumbu Y yang "bulat" (1/2/5 x 10^n) supaya garis grid rapi.
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function Legend({ series }: { series: AnalyticsPdfChart['series'] }) {
  return (
    <View style={s.legend}>
      {series.map((sr, i) => (
        <View key={i} style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: sr.color }]} />
          <Text style={s.legendText}>{sr.name}</Text>
        </View>
      ))}
    </View>
  );
}

function LineChartPdf({ chart }: { chart: AnalyticsPdfChart }) {
  const unit = chart.unit ?? 'rp';
  const W = 515, H = 150, L = 38, R = 8, T = 8, B = 20;
  const pw = W - L - R, ph = H - T - B;
  const n = chart.labels.length;
  const max = niceMax(Math.max(0, ...chart.series.flatMap(sr => sr.values)));
  const x = (i: number) => L + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => T + ph - (v / max) * ph;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const step = Math.max(1, Math.ceil(n / 7));
  const showDots = n <= 31;
  return (
    <View style={s.chartBox} wrap={false}>
      <Text style={s.chartTitle}>{chart.title}</Text>
      <Legend series={chart.series} />
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {ticks.map((tk, i) => (
          <Line key={i} x1={L} x2={W - R} y1={T + ph - tk * ph} y2={T + ph - tk * ph} stroke={tk === 0 ? '#C9BBA8' : C.border} strokeWidth={0.7} strokeDasharray={tk === 0 ? undefined : '3 3'} />
        ))}
        {ticks.map((tk, i) => (
          <Text key={`y${i}`} x={L - 4} y={T + ph - tk * ph + 2.5} style={{ fontSize: 6.5, fill: C.muted }} textAnchor="end">{fmtAxis(max * tk, unit)}</Text>
        ))}
        {chart.labels.map((lb, i) => (i % step === 0 || i === n - 1) && (
          <Text key={`x${i}`} x={x(i)} y={H - 6} style={{ fontSize: 6.5, fill: C.muted }} textAnchor="middle">{lb}</Text>
        ))}
        {chart.series.map((sr, si) => (
          <G key={si}>
            {n > 1 && <Path d={sr.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} stroke={sr.color} strokeWidth={2} fill="none" />}
            {showDots && sr.values.map((v, i) => <Circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={sr.color} stroke="#FFFFFF" strokeWidth={0.8} />)}
          </G>
        ))}
      </Svg>
    </View>
  );
}

function VBarChartPdf({ chart }: { chart: AnalyticsPdfChart }) {
  const unit = chart.unit ?? 'rp';
  const W = 515, H = 210, L = 40, R = 8, T = 14, B = 22;
  const pw = W - L - R, ph = H - T - B;
  const n = chart.labels.length;
  const all = chart.series.flatMap(sr => sr.values);
  const maxV = Math.max(0, ...all);
  const minV = Math.min(0, ...all);
  // Langkah sumbu "bulat" (1/2/5 x 10^n) supaya label seperti 2jt, 4jt, 6jt — bukan 7,4jt.
  const stepY = niceMax((maxV - minV || 1) / 4);
  const yMax = Math.ceil(maxV / stepY) * stepY || stepY;
  const yMin = Math.floor(minV / stepY) * stepY;
  const y = (v: number) => T + ph * ((yMax - v) / (yMax - yMin));
  const group = pw / n;
  const inner = group * 0.72;
  const barW = inner / chart.series.length;
  const ticks = Array.from({ length: Math.round((yMax - yMin) / stepY) + 1 }, (_, i) => yMin + i * stepY);
  const step = Math.max(1, Math.ceil(n / 14));
  return (
    <View style={s.chartBox} wrap={false}>
      <Text style={s.chartTitle}>{chart.title}</Text>
      <Legend series={chart.series} />
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {ticks.map((tv, i) => (
          <G key={i}>
            <Line x1={L} x2={W - R} y1={y(tv)} y2={y(tv)} stroke={Math.abs(tv) < 1e-9 ? '#C9BBA8' : C.border} strokeWidth={0.7} strokeDasharray={Math.abs(tv) < 1e-9 ? undefined : '3 3'} />
            <Text x={L - 4} y={y(tv) + 2.5} style={{ fontSize: 6.5, fill: C.muted }} textAnchor="end">{fmtAxis(tv, unit)}</Text>
          </G>
        ))}
        {chart.labels.map((lb, i) => i % step === 0 && (
          <Text key={`x${i}`} x={L + group * i + group / 2} y={H - 8} style={{ fontSize: 6.5, fill: C.muted }} textAnchor="middle">{lb}</Text>
        ))}
        {chart.series.map((sr, si) => {
          const top = Math.max(...sr.values);
          return (
            <G key={si}>
              {sr.values.map((v, i) => {
                if (v === 0) return null;
                const isTop = v === top && v > 0;
                const x0 = L + group * i + (group - inner) / 2 + si * barW;
                const yy = Math.min(y(v), y(0));
                return (
                  <G key={i}>
                    <Rect x={x0 + 0.6} y={yy} width={Math.max(1, barW - 1.2)} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={1.5} fill={sr.color} fillOpacity={isTop ? 1 : 0.5} />
                    {isTop && <Text x={x0 + barW / 2} y={yy - 3} style={{ fontSize: 6.5, fill: C.dark, fontFamily: 'Helvetica-Bold' }} textAnchor="middle">{fmtAxis(v, unit)}</Text>}
                  </G>
                );
              })}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

function BarChartPdf({ chart }: { chart: AnalyticsPdfChart }) {
  const unit = chart.unit ?? 'rp';
  const sr = chart.series[0];
  const max = Math.max(1, ...sr.values);
  return (
    <View style={s.chartBox} wrap={false}>
      <Text style={s.chartTitle}>{chart.title}</Text>
      {chart.labels.map((lb, i) => (
        <View key={i} style={s.barRow}>
          <Text style={s.barLabel}>{lb.length > 28 ? `${lb.slice(0, 27)}.` : lb}</Text>
          <View style={s.barTrack}><View style={[s.barFill, { width: `${Math.max(1.5, (sr.values[i] / max) * 100)}%`, backgroundColor: sr.color }]} /></View>
          <Text style={s.barValue}>{fmtFull(sr.values[i], unit)}</Text>
        </View>
      ))}
    </View>
  );
}

function Chart({ chart }: { chart: AnalyticsPdfChart }) {
  if (chart.labels.length === 0 || chart.series.length === 0) return null;
  if (chart.type === 'line') return <LineChartPdf chart={chart} />;
  return chart.type === 'vbar' ? <VBarChartPdf chart={chart} /> : <BarChartPdf chart={chart} />;
}

function Section({ sec }: { sec: AnalyticsPdfSection }) {
  return (
    <View>
      <Text style={s.sectionTitle} minPresenceAhead={60}>{sec.title}</Text>
      {sec.rows.length === 0 ? <Text style={s.empty}>{sec.emptyText ?? 'Tidak ada data.'}</Text> : (
        <View style={s.table}>
          <View style={s.tHeadRow} wrap={false}>
            {sec.columns.map((c, i) => <Text key={i} style={[s.tHeadCell, { width: c.width, textAlign: c.align ?? 'left' }]}>{c.header}</Text>)}
          </View>
          {sec.rows.map((row, ri) => (
            <View key={ri} style={[s.tRow, ...(sec.highlightRows?.includes(ri) ? [s.tRowHi] : ri % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
              {row.map((cell, ci) => (
                <Text key={ci} style={[s.tCell, { width: sec.columns[ci].width, textAlign: sec.columns[ci].align ?? 'left' }, sec.columns[ci].bold ? { fontFamily: 'Helvetica-Bold' } : {}]}>
                  {cell === '' ? '-' : String(cell)}
                </Text>
              ))}
            </View>
          ))}
          {sec.total && (
            <View style={s.tTotalRow} wrap={false}>
              {sec.total.map((cell, ci) => (
                <Text key={ci} style={[s.tTotalCell, { width: sec.columns[ci].width, textAlign: sec.columns[ci].align ?? 'left' }]}>{String(cell)}</Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function AnalyticsReportPDF({ data, store }: { data: AnalyticsReportData; store: StoreHeader }) {
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <View style={s.topBar} />
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {store.logo && <Image src={store.logo} style={s.logo} />}
            <View style={s.storeInfo}>
              <Text style={s.storeName}>{store.name}</Text>
              {store.tagline && <Text style={s.storeTagline}>{store.tagline}</Text>}
              {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>{data.title}</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <Text style={s.docMeta}>Periode: {data.periodLabel}</Text>
            <Text style={s.docMeta}>Dicetak: {data.generatedAt}</Text>
          </View>
        </View>
        <View style={s.divider} />

        {data.cards.length > 0 && (
          <View style={s.cards}>
            {data.cards.map((c, i) => (
              <View key={i} style={s.card} wrap={false}>
                <Text style={s.cardLabel}>{c.label}</Text>
                <Text style={s.cardVal}>{c.value}</Text>
              </View>
            ))}
          </View>
        )}

        {(data.charts ?? []).map((ch, i) => <Chart key={i} chart={ch} />)}

        {data.sections.map((sec, i) => <Section key={i} sec={sec} />)}

        <Text style={s.footer} fixed>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}

// Format bersama untuk builder data PDF analitik.
export const pdfRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
export const pdfDate = (d: string) => {
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const pdfNow = () => new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
