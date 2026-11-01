import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';
import { formatReportDay, type MitraDailyReportSection } from '@/lib/mitra-daily-report';

export interface MitraDailyReportData {
  periodText:  string;
  generatedAt: string;
  sections:    MitraDailyReportSection[];
}

const C = {
  accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#A08468',
  border: '#E6DDD0', white: '#FFFFFF', green: '#15803D',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, paddingBottom: 54, fontSize: 10 },
  topBar: { height: 8, backgroundColor: C.accent, marginTop: -40, marginHorizontal: -40, marginBottom: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 52, height: 52, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  storeName: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  storeTagline: { fontSize: 8.5, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', width: '42%', flexShrink: 0 },
  docTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5, textAlign: 'right' },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  docMeta: { fontSize: 8.5, color: C.muted, marginTop: 4, textAlign: 'right' },
  docMetaBold: { fontFamily: 'Helvetica-Bold', color: C.dark },
  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 6 },

  sectionHead: { backgroundColor: C.accentBg, borderRadius: 6, padding: 10, marginTop: 12, marginBottom: 4 },
  sectionName: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  sectionSub: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  empty: { fontSize: 9, color: C.muted, marginTop: 6, marginBottom: 6 },

  dayTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 4 },
  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHead: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: '#FFFAF5' },
  tRowTotal: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.accentBg },
  tCell: { fontSize: 8.5, paddingVertical: 5, paddingHorizontal: 6 },
  tCellBold: { fontFamily: 'Helvetica-Bold' },
  colName: { width: '36%' },
  colNum: { width: '12.8%', textAlign: 'right' },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
  pageNo: { position: 'absolute', bottom: 24, right: 40, fontSize: 7.5, color: C.muted },
});

function Head() {
  return (
    <View style={s.tHead}>
      <Text style={[s.tHeadCell, s.colName]}>Produk</Text>
      <Text style={[s.tHeadCell, s.colNum]}>Kirim</Text>
      <Text style={[s.tHeadCell, s.colNum]}>Jual</Text>
      <Text style={[s.tHeadCell, s.colNum]}>Retur</Text>
      <Text style={[s.tHeadCell, s.colNum]}>Reject</Text>
      <Text style={[s.tHeadCell, s.colNum]}>Stok Akhir</Text>
    </View>
  );
}

export default function MitraDailyReportPDF({ data, store }: { data: MitraDailyReportData; store: StoreHeader }) {
  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        <View style={s.topBar} />
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {store.logo && <Image src={store.logo} style={s.logo} />}
            <View style={s.storeInfo}>
              <Text style={s.storeName}>{store.name}</Text>
              {store.tagline && <Text style={s.storeTagline}>{store.tagline}</Text>}
              {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
              {store.phone && <Text style={s.storeMeta}>{store.phone}</Text>}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>LAPORAN HARIAN MITRA</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <Text style={s.docMeta}>Periode: <Text style={s.docMetaBold}>{data.periodText}</Text></Text>
            <Text style={s.docMeta}>Dicetak: <Text style={s.docMetaBold}>{data.generatedAt}</Text></Text>
          </View>
        </View>
        <View style={s.divider} />

        {data.sections.map(sec => (
          <View key={sec.locationId}>
            <View style={s.sectionHead} wrap={false}>
              <Text style={s.sectionName}>{sec.locationName}</Text>
              <Text style={s.sectionSub}>
                Periode ini: kirim {sec.totals.kirim} · jual {sec.totals.jual} · retur {sec.totals.retur} · reject {sec.totals.reject}  |  Stok saat ini: {sec.currentStock} pcs
              </Text>
            </View>
            {sec.days.length === 0 && <Text style={s.empty}>Tidak ada kirim maupun rekap pada periode ini.</Text>}
            {sec.days.map(day => (
              <View key={day.date}>
                <Text style={s.dayTitle} minPresenceAhead={60}>{formatReportDay(day.date)}</Text>
                <View style={s.table}>
                  <Head />
                  {day.rows.map((r, i) => (
                    <View key={r.productId} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
                      <Text style={[s.tCell, s.colName]}>{r.productName}</Text>
                      <Text style={[s.tCell, s.colNum]}>{r.kirim || '-'}</Text>
                      <Text style={[s.tCell, s.colNum]}>{r.jual || '-'}</Text>
                      <Text style={[s.tCell, s.colNum]}>{r.retur || '-'}</Text>
                      <Text style={[s.tCell, s.colNum]}>{r.reject || '-'}</Text>
                      <Text style={[s.tCell, s.colNum, s.tCellBold]}>{r.stokAkhir}</Text>
                    </View>
                  ))}
                  <View style={s.tRowTotal} wrap={false}>
                    <Text style={[s.tCell, s.colName, s.tCellBold]}>Total</Text>
                    <Text style={[s.tCell, s.colNum, s.tCellBold]}>{day.totals.kirim}</Text>
                    <Text style={[s.tCell, s.colNum, s.tCellBold]}>{day.totals.jual}</Text>
                    <Text style={[s.tCell, s.colNum, s.tCellBold]}>{day.totals.retur}</Text>
                    <Text style={[s.tCell, s.colNum, s.tCellBold]}>{day.totals.reject}</Text>
                    <Text style={[s.tCell, s.colNum, s.tCellBold]}>{day.totals.stokAkhir}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ))}

        <Text style={s.footer} fixed>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
