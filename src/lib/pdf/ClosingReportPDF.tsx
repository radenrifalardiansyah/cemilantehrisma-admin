import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import { formatRp } from '@/lib/format';
import type { StoreHeader } from './ShipmentNotePDF';
import { dayLabel, type ClosingPdfData, type PdfSection } from './closing-pdf-data';

// PDF Closing HPP (resmi / saldo awal / draf). Gaya mengikuti ProductReportPDF (kop, ringkasan, tabel, nomor halaman).
// Data sudah dipetakan oleh closing-pdf-data.ts; komponen ini hanya menata.

const C = {
  accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#A08468', border: '#E6DDD0', white: '#FFFFFF',
  warn: '#B45309', warnBg: '#FEF3C7',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 32, paddingBottom: 46, fontSize: 9 },
  topBar: { height: 7, backgroundColor: C.accent, marginTop: -32, marginHorizontal: -32, marginBottom: 18 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 44, height: 44, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  storeName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  storeTagline: { fontSize: 8, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8, color: C.muted, marginTop: 1 },
  headerRight: { alignItems: 'flex-end', width: '42%', flexShrink: 0 },
  docTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5, textAlign: 'right' },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 3 },
  docMetaLabel: { fontSize: 8, color: C.muted },
  docMetaValue: { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 10, marginBottom: 12 },

  infoBox: { backgroundColor: C.accentBg, borderRadius: 6, padding: 9, marginBottom: 10 },
  infoRow: { flexDirection: 'row', marginBottom: 2.5 },
  infoLabel: { width: 98, fontSize: 8, color: C.muted },
  infoValue: { flex: 1, fontSize: 8.5, fontFamily: 'Helvetica-Bold' },

  notice: { borderRadius: 6, borderWidth: 1, borderColor: C.warn, backgroundColor: C.warnBg, padding: 8, marginBottom: 10 },
  noticeText: { fontSize: 8.5, color: C.warn, lineHeight: 1.4 },

  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryBox: { width: '23.5%', borderRadius: 6, borderWidth: 1, borderColor: C.border, padding: 7 },
  summaryBoxDraft: { width: '31.5%' },
  summaryLabel: { fontSize: 6.8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.2, marginBottom: 2 },
  summaryValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold' },

  sectionTitle: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginTop: 16 },
  sectionHint: { fontSize: 7.5, color: C.muted, marginTop: 1, marginBottom: 5 },
  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border, marginTop: 4 },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 6.8, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 3 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 7.2, paddingVertical: 4.5, paddingHorizontal: 3 },
  totalsRow: { flexDirection: 'row', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border },
  totalsCell: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 3 },
  empty: { fontSize: 8.5, color: C.muted, paddingVertical: 8, textAlign: 'center' },
  smallNote: { fontSize: 7.5, color: C.muted, marginTop: 5, lineHeight: 1.4 },

  colNo: { width: '5%' }, colInv: { width: '30%' }, colTx: { width: '12.5%' }, colPay: { width: '12.5%' },
  colQty: { width: '8%', textAlign: 'right' }, colHpp: { width: '16%', textAlign: 'right' }, colOmz: { width: '16%', textAlign: 'right' },

  watermark: { position: 'absolute', top: 300, left: 70, fontSize: 110, fontFamily: 'Helvetica-Bold', color: '#F4E9DE', transform: 'rotate(-35deg)' },
  footer: { position: 'absolute', bottom: 18, left: 32, right: 70, fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: C.muted },
});

const qty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

function Table({ section }: { section: PdfSection }) {
  return (
    <View>
      <Text style={s.sectionTitle} minPresenceAhead={60}>{section.title}</Text>
      {section.hint && <Text style={s.sectionHint}>{section.hint}</Text>}
      {section.lines.length === 0 ? (
        <Text style={s.empty}>{section.emptyText}</Text>
      ) : (
        <View style={s.table}>
          <View style={s.tHeadRow} fixed>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colInv]}>Invoice / Pihak</Text>
            <Text style={[s.tHeadCell, s.colTx]}>Tgl Transaksi</Text>
            <Text style={[s.tHeadCell, s.colPay]}>Tgl Bayar</Text>
            <Text style={[s.tHeadCell, s.colQty]}>Qty</Text>
            <Text style={[s.tHeadCell, s.colHpp]}>HPP</Text>
            <Text style={[s.tHeadCell, s.colOmz]}>Omzet</Text>
          </View>
          {section.lines.map((l, i) => (
            <View key={l.no} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
              <Text style={[s.tCell, s.colNo]}>{l.no}</Text>
              <View style={[s.colInv, { paddingVertical: 4.5, paddingHorizontal: 3 }]}>
                <Text style={{ fontSize: 7.2, fontFamily: 'Helvetica-Bold' }}>{l.invoice || '–'}</Text>
                <Text style={{ fontSize: 6.8, color: C.muted }}>{l.party}{l.note ? ` · ${l.note}` : ''}</Text>
              </View>
              <Text style={[s.tCell, s.colTx]}>{dayLabel(l.txDate)}</Text>
              <Text style={[s.tCell, s.colPay]}>{dayLabel(l.paidDate)}</Text>
              <Text style={[s.tCell, s.colQty]}>{qty(l.qty)}</Text>
              <Text style={[s.tCell, s.colHpp]}>{formatRp(l.cogs)}</Text>
              <Text style={[s.tCell, s.colOmz]}>{formatRp(l.revenue)}</Text>
            </View>
          ))}
          <View style={s.totalsRow} wrap={false}>
            <Text style={[s.totalsCell, s.colNo]} />
            <Text style={[s.totalsCell, s.colInv]}>Total ({section.totals.count} transaksi)</Text>
            <Text style={[s.totalsCell, s.colTx]} />
            <Text style={[s.totalsCell, s.colPay]} />
            <Text style={[s.totalsCell, s.colQty]}>{qty(section.totals.qty)}</Text>
            <Text style={[s.totalsCell, s.colHpp]}>{formatRp(section.totals.cogs)}</Text>
            <Text style={[s.totalsCell, s.colOmz, { color: C.accent }]}>{formatRp(section.totals.revenue)}</Text>
          </View>
        </View>
      )}
      {section.omitted > 0 && (
        <Text style={s.smallNote}>Rincian dibatasi pada {section.lines.length} baris pertama; {section.omitted} baris lainnya tidak dicetak. Total di atas mencakup semuanya.</Text>
      )}
    </View>
  );
}

export default function ClosingReportPDF({ data, store }: { data: ClosingPdfData; store: StoreHeader }) {
  const draft = data.variant === 'draft';
  return (
    <Document title={`${data.title} ${data.periodText}`}>
      <Page size="A4" style={s.page}>
        {draft && <Text style={s.watermark} fixed>DRAF</Text>}
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
            <Text style={s.docSub}>{data.subtitle}</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Dicetak:</Text>
              <Text style={s.docMetaValue}>{data.generatedAt}</Text>
            </View>
          </View>
        </View>
        <View style={s.divider} />

        <View style={s.infoBox}>
          {data.meta.map(m => (
            <View key={m.label} style={s.infoRow}>
              <Text style={s.infoLabel}>{m.label}</Text>
              <Text style={s.infoValue}>{m.value}</Text>
            </View>
          ))}
        </View>

        {data.notice && (
          <View style={s.notice}><Text style={s.noticeText}>{data.notice}</Text></View>
        )}

        <View style={s.summaryRow}>
          {data.summary.map(b => (
            <View key={b.label} style={[s.summaryBox, ...(draft ? [s.summaryBoxDraft] : [])]}>
              <Text style={s.summaryLabel}>{b.label}</Text>
              <Text style={s.summaryValue}>{b.value}</Text>
            </View>
          ))}
        </View>

        {data.sections.map(sec => <Table key={sec.title} section={sec} />)}

        {data.notes.map((n, i) => <Text key={i} style={s.smallNote}>{n}</Text>)}

        <Text style={s.footer} fixed>
          {draft ? 'DRAF — bukan closing resmi. ' : ''}Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}
        </Text>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
