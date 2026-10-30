import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
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
  emptyText?: string;
}
export interface AnalyticsReportData {
  title: string;                       // mis. "ANALITIK MITRA"
  periodLabel: string;
  generatedAt: string;
  cards: { label: string; value: string }[];
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
  tCell: { fontSize: 7.5, paddingVertical: 4.5, paddingHorizontal: 4 },
  tTotalRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.accentBg },
  tTotalCell: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 4 },
  empty: { fontSize: 8.5, color: C.muted, marginBottom: 14 },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: C.muted },
});

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
            <View key={ri} style={[s.tRow, ...(ri % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
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
