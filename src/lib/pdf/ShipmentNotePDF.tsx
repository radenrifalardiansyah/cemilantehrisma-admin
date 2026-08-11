import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

export interface ShipmentNoteItem { productName: string; qty: number; hargaTitip: number; subtotal: number }

export interface ShipmentNoteData {
  locationName:  string;
  contactName?:  string;
  contactPhone?: string;
  address?:      string;
  warehouseName?: string;
  date:          string;
  docNo?:        string;
  note?:         string;
  items:         ShipmentNoteItem[];
  total:         number;
}

export interface StoreHeader { name: string; tagline?: string; address?: string; phone?: string; logo?: string }

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

const C = {
  accent:     '#D4691E',
  accentBg:   '#FDF0E6',
  dark:       '#1E1008',
  muted:      '#A08468',
  border:     '#E6DDD0',
  white:      '#FFFFFF',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, fontSize: 10 },

  topBar: { height: 8, backgroundColor: C.accent, marginTop: -40, marginHorizontal: -40, marginBottom: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, maxWidth: '62%', flexShrink: 1 },
  logo: { width: 52, height: 52, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexShrink: 1 },
  storeName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeTagline: { fontSize: 8.5, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', maxWidth: '35%', flexShrink: 0 },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  docMetaLabel: { fontSize: 8.5, color: C.muted },
  docMetaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoRow: { flexDirection: 'row', gap: 16 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },
  infoSub: { fontSize: 9, color: C.muted, marginTop: 2 },

  table: { marginTop: 18, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 9, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 8 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 9.5, paddingVertical: 6, paddingHorizontal: 8, color: C.dark },

  colNo:    { width: '8%' },
  colName:  { width: '42%' },
  colQty:   { width: '14%', textAlign: 'right' },
  colPrice: { width: '18%', textAlign: 'right' },
  colSub:   { width: '18%', textAlign: 'right' },

  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, alignItems: 'center' },
  totalLabel: { fontSize: 10, color: C.muted, marginRight: 10 },
  totalValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent },

  noteBox: { marginTop: 14, padding: 10, backgroundColor: C.accentBg, borderRadius: 6 },
  noteLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', marginBottom: 3 },
  noteText: { fontSize: 9.5, color: C.dark },

  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 44 },
  signBox: { width: '42%', alignItems: 'center' },
  signLabel: { fontSize: 9, color: C.muted },
  signLine: { borderTopWidth: 1, borderTopColor: C.dark, width: '100%', marginTop: 46 },
  signName: { fontSize: 9, color: C.muted, marginTop: 4 },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
});

export default function ShipmentNotePDF({ data, store }: { data: ShipmentNoteData; store: StoreHeader }) {
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
            <Text style={s.docTitle}>NOTA KIRIM STOK</Text>
            {data.docNo && (
              <View style={s.docMetaRow}>
                <Text style={s.docMetaLabel}>No:</Text>
                <Text style={s.docMetaValue}>{data.docNo}</Text>
              </View>
            )}
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Tanggal:</Text>
              <Text style={s.docMetaValue}>{data.date}</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.infoRow}>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Dikirim Kepada</Text>
            <Text style={s.infoValue}>{data.locationName}</Text>
            {data.contactName && <Text style={s.infoSub}>{data.contactName}</Text>}
            {data.contactPhone && <Text style={s.infoSub}>{data.contactPhone}</Text>}
            {data.address && <Text style={s.infoSub}>{data.address}</Text>}
          </View>
          {data.warehouseName && (
            <View style={s.infoBox}>
              <Text style={s.infoLabel}>Gudang Asal</Text>
              <Text style={s.infoValue}>{data.warehouseName}</Text>
            </View>
          )}
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colName]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colQty]}>Qty</Text>
            <Text style={[s.tHeadCell, s.colPrice]}>Harga Titip</Text>
            <Text style={[s.tHeadCell, s.colSub]}>Subtotal</Text>
          </View>
          {data.items.map((it, i) => (
            <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]}>
              <Text style={[s.tCell, s.colNo]}>{i + 1}</Text>
              <Text style={[s.tCell, s.colName]}>{it.productName}</Text>
              <Text style={[s.tCell, s.colQty]}>{it.qty} pcs</Text>
              <Text style={[s.tCell, s.colPrice]}>{rp(it.hargaTitip)}</Text>
              <Text style={[s.tCell, s.colSub]}>{rp(it.subtotal)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totalRow}>
          <Text style={s.totalLabel}>Total Nilai Titip</Text>
          <Text style={s.totalValue}>{rp(data.total)}</Text>
        </View>

        {data.note && (
          <View style={s.noteBox}>
            <Text style={s.noteLabel}>Catatan</Text>
            <Text style={s.noteText}>{data.note}</Text>
          </View>
        )}

        <View style={s.signRow}>
          <View style={s.signBox}>
            <Text style={s.signLabel}>Yang Mengirim</Text>
            <View style={s.signLine} />
            <Text style={s.signName}>{store.name}</Text>
          </View>
          <View style={s.signBox}>
            <Text style={s.signLabel}>Yang Menerima</Text>
            <View style={s.signLine} />
            <Text style={s.signName}>{data.locationName}</Text>
          </View>
        </View>

        <Text style={s.footer}>Nota ini dibuat otomatis oleh sistem — {store.name}</Text>
      </Page>
    </Document>
  );
}
