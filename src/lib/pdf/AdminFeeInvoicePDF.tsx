import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

export interface AdminFeeInvoiceRow {
  label: string;
  revenue: number;
  transactionCount: number;
  rateLabel: string;
  feeAmount: number;
}

export interface AdminFeeInvoiceData {
  invoiceNo: string;
  clientName: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  status: string;
  rows: AdminFeeInvoiceRow[];
  totalRevenue: number;
  totalFee: number;
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

const C = {
  accent:   '#D4691E',
  accentBg: '#FDF0E6',
  dark:     '#1E1008',
  muted:    '#A08468',
  border:   '#E6DDD0',
  white:    '#FFFFFF',
  green:    '#15803D',
  greenBg:  '#DCFCE7',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, fontSize: 10 },

  topBar: { height: 8, backgroundColor: C.accent, marginTop: -40, marginHorizontal: -40, marginBottom: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  issuerName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.dark },
  issuerMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5 },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  metaRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark, marginTop: 20, marginBottom: 8 },

  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 8.5, paddingVertical: 6, paddingHorizontal: 6, color: C.dark },

  colChannel: { width: '28%' },
  colRevenue: { width: '22%', textAlign: 'right' },
  colCount: { width: '14%', textAlign: 'center' },
  colRate: { width: '16%', textAlign: 'right' },
  colFee: { width: '20%', textAlign: 'right' },

  totalRow: { flexDirection: 'row', backgroundColor: C.greenBg, borderTopWidth: 1.5, borderTopColor: C.green },
  totalLabel: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.dark, paddingVertical: 9, paddingHorizontal: 6, width: '64%' },
  totalValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.green, paddingVertical: 9, paddingHorizontal: 6, width: '36%', textAlign: 'right' },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
});

export default function AdminFeeInvoicePDF({ data }: { data: AdminFeeInvoiceData }) {
  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        <View style={s.topBar} />

        <View style={s.headerRow}>
          <View>
            <Text style={s.issuerName}>PT. Eleven Digital Indonesia</Text>
            <Text style={s.issuerMeta}>RMedia Solutions — Penyedia Platform Admin</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>INVOICE BIAYA ADMIN</Text>
            <Text style={s.docSub}>Dokumen Internal — Tidak untuk Pembeli Akhir</Text>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.metaRow}>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Ditagihkan Kepada</Text>
            <Text style={s.infoValue}>{data.clientName}</Text>
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>No. Invoice</Text>
            <Text style={s.infoValue}>{data.invoiceNo}</Text>
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Periode</Text>
            <Text style={s.infoValue}>{data.periodFrom} – {data.periodTo}</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>Rincian Biaya Admin per Channel</Text>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colChannel]}>Channel</Text>
            <Text style={[s.tHeadCell, s.colRevenue]}>Omzet</Text>
            <Text style={[s.tHeadCell, s.colCount]}>Transaksi</Text>
            <Text style={[s.tHeadCell, s.colRate]}>Rate</Text>
            <Text style={[s.tHeadCell, s.colFee]}>Biaya Admin</Text>
          </View>
          {data.rows.map((r, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
              <Text style={[s.tCell, s.colChannel]}>{r.label}</Text>
              <Text style={[s.tCell, s.colRevenue]}>{rp(r.revenue)}</Text>
              <Text style={[s.tCell, s.colCount]}>{r.transactionCount}</Text>
              <Text style={[s.tCell, s.colRate]}>{r.rateLabel}</Text>
              <Text style={[s.tCell, s.colFee]}>{rp(r.feeAmount)}</Text>
            </View>
          ))}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>TOTAL BIAYA ADMIN</Text>
            <Text style={s.totalValue}>{rp(data.totalFee)}</Text>
          </View>
        </View>

        <Text style={s.footer}>Dicetak {data.generatedAt} — Dokumen internal RMedia Solutions</Text>
      </Page>
    </Document>
  );
}
