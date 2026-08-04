import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import type { StoreHeader } from './ShipmentNotePDF';

export interface RecapNoteItem {
  productName: string; qtySold: number; qtyRetur: number; qtyReject: number; hargaTitip: number; revenue: number;
}

export interface RecapNoteData {
  locationName:    string;
  warehouseName?:  string;
  date:            string;
  paymentStatus?:  'lunas' | 'belum_lunas';
  note?:           string;
  items:           RecapNoteItem[];
  totalSold:       number;
  totalRetur:      number;
  totalReject:     number;
  totalRevenue:    number;
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
  amber:    '#B45309',
  amberBg:  '#FEF3C7',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, fontSize: 10 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 40, height: 40, borderRadius: 20, objectFit: 'cover' },
  storeName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5 },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  docDate: { fontSize: 9, color: C.muted, marginTop: 3 },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoRow: { flexDirection: 'row', gap: 16 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  badge: { alignSelf: 'flex-start', borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7, fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 4 },

  table: { marginTop: 18, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 9, paddingVertical: 6, paddingHorizontal: 6, color: C.dark },

  colNo:     { width: '6%' },
  colName:   { width: '28%' },
  colSold:   { width: '13%', textAlign: 'right' },
  colRetur:  { width: '13%', textAlign: 'right' },
  colReject: { width: '13%', textAlign: 'right' },
  colPrice:  { width: '13%', textAlign: 'right' },
  colRev:    { width: '14%', textAlign: 'right' },

  totalsWrap: { marginTop: 14, alignItems: 'flex-end' },
  totalsBox: { width: '48%', backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  totalsLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  totalsKey: { fontSize: 9, color: C.muted },
  totalsVal: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  totalsFinalKey: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalVal: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent },

  noteBox: { marginTop: 14, padding: 10, backgroundColor: C.accentBg, borderRadius: 6 },
  noteLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', marginBottom: 3 },
  noteText: { fontSize: 9.5, color: C.dark },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
});

export default function RecapNotePDF({ data, store }: { data: RecapNoteData; store: StoreHeader }) {
  const isLunas = (data.paymentStatus ?? 'lunas') === 'lunas';
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {store.logo && <Image src={store.logo} style={s.logo} />}
            <View>
              <Text style={s.storeName}>{store.name}</Text>
              {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
              {store.phone && <Text style={s.storeMeta}>{store.phone}</Text>}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>REKAP HARIAN</Text>
            <Text style={s.docSub}>Dokumen Internal</Text>
            <Text style={s.docDate}>{data.date}</Text>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.infoRow}>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Lokasi / Mitra</Text>
            <Text style={s.infoValue}>{data.locationName}</Text>
            <Text
              style={[s.badge, isLunas
                ? { backgroundColor: C.greenBg, color: C.green }
                : { backgroundColor: C.amberBg, color: C.amber }]}
            >
              {isLunas ? 'LUNAS' : 'BELUM LUNAS'}
            </Text>
          </View>
          {data.warehouseName && (
            <View style={s.infoBox}>
              <Text style={s.infoLabel}>Gudang Tujuan Retur/Reject</Text>
              <Text style={s.infoValue}>{data.warehouseName}</Text>
            </View>
          )}
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colName]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colSold]}>Terjual</Text>
            <Text style={[s.tHeadCell, s.colRetur]}>Retur</Text>
            <Text style={[s.tHeadCell, s.colReject]}>Reject</Text>
            <Text style={[s.tHeadCell, s.colPrice]}>Harga Titip</Text>
            <Text style={[s.tHeadCell, s.colRev]}>Pendapatan</Text>
          </View>
          {data.items.map((it, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]}>
              <Text style={[s.tCell, s.colNo]}>{i + 1}</Text>
              <Text style={[s.tCell, s.colName]}>{it.productName}</Text>
              <Text style={[s.tCell, s.colSold]}>{it.qtySold}</Text>
              <Text style={[s.tCell, s.colRetur]}>{it.qtyRetur}</Text>
              <Text style={[s.tCell, s.colReject]}>{it.qtyReject}</Text>
              <Text style={[s.tCell, s.colPrice]}>{rp(it.hargaTitip)}</Text>
              <Text style={[s.tCell, s.colRev]}>{rp(it.revenue)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total Terjual</Text>
              <Text style={s.totalsVal}>{data.totalSold} pcs</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total Retur</Text>
              <Text style={s.totalsVal}>{data.totalRetur} pcs</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total Reject</Text>
              <Text style={s.totalsVal}>{data.totalReject} pcs</Text>
            </View>
            <View style={s.totalsFinalLine}>
              <Text style={s.totalsFinalKey}>Total Pendapatan</Text>
              <Text style={s.totalsFinalVal}>{rp(data.totalRevenue)}</Text>
            </View>
          </View>
        </View>

        {data.note && (
          <View style={s.noteBox}>
            <Text style={s.noteLabel}>Catatan</Text>
            <Text style={s.noteText}>{data.note}</Text>
          </View>
        )}

        <Text style={s.footer}>Dokumen internal — {store.name}</Text>
      </Page>
    </Document>
  );
}
