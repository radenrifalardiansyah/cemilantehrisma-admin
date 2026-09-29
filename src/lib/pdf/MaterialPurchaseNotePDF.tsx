import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

export interface MaterialPurchaseNoteItem { materialName: string; unit: string; qty: number; price: number; subtotal: number }

export interface MaterialPurchaseNoteData {
  id:            string;
  date:          string;
  printedAt?:    string;
  supplierName:  string;
  items:         MaterialPurchaseNoteItem[];
  total:         number;
  paymentStatus?: 'lunas' | 'belum_lunas';
  walletName?:   string;
  note?:         string;
  voided?:       boolean;
  voidNote?:     string;
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const C = {
  accent:   THEME_COLOR,
  accentBg: '#FDF0E6',
  dark:     '#1E1008',
  muted:    '#A08468',
  border:   '#E6DDD0',
  white:    '#FFFFFF',
  green:    '#15803D',
  greenBg:  '#DCFCE7',
  amber:    '#B45309',
  amberBg:  '#FEF3C7',
  gray:     '#6B7280',
  grayBg:   '#F3F4F6',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, fontSize: 10 },

  topBar: { height: 8, backgroundColor: C.accent, marginTop: -40, marginHorizontal: -40, marginBottom: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 52, height: 52, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  storeName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeTagline: { fontSize: 8.5, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', width: '40%', flexShrink: 0 },
  docTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.3, textAlign: 'right' },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  docMetaLabel: { fontSize: 8.5, color: C.muted },
  docMetaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoRow: { flexDirection: 'row', gap: 16 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },
  infoSub: { fontSize: 9, color: C.muted, marginTop: 2 },
  badge: { alignSelf: 'flex-start', borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7, fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 4 },

  table: { marginTop: 18, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 9, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 8 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 9.5, paddingVertical: 6, paddingHorizontal: 8, color: C.dark },

  colNo:    { width: '8%' },
  colName:  { width: '38%' },
  colQty:   { width: '16%', textAlign: 'right' },
  colPrice: { width: '19%', textAlign: 'right' },
  colSub:   { width: '19%', textAlign: 'right' },

  totalsWrap: { marginTop: 14, alignItems: 'flex-end' },
  totalsBox: { width: '48%', backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  totalsFinalLine: { flexDirection: 'row', justifyContent: 'space-between' },
  totalsFinalKey: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalVal: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent },

  noteBox: { marginTop: 14, padding: 10, backgroundColor: C.accentBg, borderRadius: 6 },
  noteLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', marginBottom: 3 },
  noteText: { fontSize: 9.5, color: C.dark },

  voidBox: { marginTop: 14, padding: 10, backgroundColor: C.grayBg, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  voidLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.gray, textTransform: 'uppercase' },
  voidText: { fontSize: 9, color: C.gray, marginTop: 3 },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
});

export default function MaterialPurchaseNotePDF({ data, store }: { data: MaterialPurchaseNoteData; store: StoreHeader }) {
  const isLunas = (data.paymentStatus ?? 'lunas') === 'lunas';
  return (
    <Document>
      <Page size="A4" style={s.page}>
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
            <Text style={s.docTitle}>NOTA PEMBELIAN</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Tanggal:</Text>
              <Text style={s.docMetaValue}>{data.date}</Text>
            </View>
            {data.printedAt && (
              <View style={s.docMetaRow}>
                <Text style={s.docMetaLabel}>Dicetak:</Text>
                <Text style={s.docMetaValue}>{data.printedAt}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.infoRow}>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Supplier</Text>
            <Text style={s.infoValue}>{data.supplierName || 'Tanpa nama'}</Text>
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Pembayaran</Text>
            <Text style={s.infoValue}>{data.walletName || '-'}</Text>
            <Text
              style={[s.badge, isLunas
                ? { backgroundColor: C.greenBg, color: C.green }
                : { backgroundColor: C.amberBg, color: C.amber }]}
            >
              {isLunas ? 'LUNAS' : 'BELUM LUNAS'}
            </Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colName]}>Bahan Baku</Text>
            <Text style={[s.tHeadCell, s.colQty]}>Qty</Text>
            <Text style={[s.tHeadCell, s.colPrice]}>Harga</Text>
            <Text style={[s.tHeadCell, s.colSub]}>Subtotal</Text>
          </View>
          {data.items.map((it, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]}>
              <Text style={[s.tCell, s.colNo]}>{i + 1}</Text>
              <Text style={[s.tCell, s.colName]}>{it.materialName}</Text>
              <Text style={[s.tCell, s.colQty]}>{it.qty} {it.unit}</Text>
              <Text style={[s.tCell, s.colPrice]}>{rp(it.price)}</Text>
              <Text style={[s.tCell, s.colSub]}>{rp(it.subtotal)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsFinalLine}>
              <Text style={s.totalsFinalKey}>Total</Text>
              <Text style={s.totalsFinalVal}>{rp(data.total)}</Text>
            </View>
          </View>
        </View>

        {data.note && (
          <View style={s.noteBox}>
            <Text style={s.noteLabel}>Catatan</Text>
            <Text style={s.noteText}>{data.note}</Text>
          </View>
        )}

        {data.voided && (
          <View style={s.voidBox}>
            <Text style={s.voidLabel}>Pembelian ini dibatalkan</Text>
            {data.voidNote && <Text style={s.voidText}>Alasan: {data.voidNote}</Text>}
          </View>
        )}

        <Text style={s.footer}>Nota ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
      </Page>
    </Document>
  );
}
