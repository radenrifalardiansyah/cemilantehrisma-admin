import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

// Daftar Belanja bahan baku untuk SATU tanggal: dikelompokkan per supplier, tiap supplier punya
// tabel item + subtotal, ditutup total tanggal. Kolom "Dibeli" berupa kotak kosong supaya bisa
// dicentang manual saat belanja (kalau sudah diproses di sistem, tertulis "Sudah").
export interface ShoppingListPDFItem {
  no: number; name: string; qty: string; unit: string; price: number | null; subtotal: number; bought: boolean;
}
export interface ShoppingListPDFSupplier {
  name: string; notes: string; status: string; wallet: string; items: ShoppingListPDFItem[]; total: number;
}
export interface ShoppingListPDFData {
  no: number; dateLabel: string; generatedAt: string; itemCount: number; grandTotal: number;
  suppliers: ShoppingListPDFSupplier[];
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const C = {
  accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#A08468',
  border: '#E6DDD0', white: '#FFFFFF', green: '#15803D',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 32, paddingBottom: 48, fontSize: 9 },
  topBar: { height: 7, backgroundColor: C.accent, marginTop: -32, marginHorizontal: -32, marginBottom: 18 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 44, height: 44, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
  storeName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeTagline: { fontSize: 8, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8, color: C.muted, marginTop: 1 },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.5 },
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 3 },
  docMetaLabel: { fontSize: 8, color: C.muted },
  docMetaValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 10, marginBottom: 12 },

  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryBox: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: C.border, padding: 7 },
  summaryLabel: { fontSize: 6.8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.2, marginBottom: 2 },
  summaryValue: { fontSize: 11, fontFamily: 'Helvetica-Bold' },

  section: { marginBottom: 12 },
  supHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 },
  supName: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },
  supMeta: { fontSize: 7.5, color: C.muted, marginTop: 1 },
  supStatus: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.accent },

  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 4 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, alignItems: 'center' },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 8, paddingVertical: 4.5, paddingHorizontal: 4, color: C.dark },
  totalsRow: { flexDirection: 'row', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border },
  totalsCell: { fontSize: 8, fontFamily: 'Helvetica-Bold', paddingVertical: 5, paddingHorizontal: 4, color: C.dark },

  colNo: { width: '6%' },
  colName: { width: '34%' },
  colQty: { width: '10%', textAlign: 'right' },
  colUnit: { width: '8%' },
  colPrice: { width: '16%', textAlign: 'right' },
  colSub: { width: '16%', textAlign: 'right' },
  colBought: { width: '10%', alignItems: 'center', justifyContent: 'center' },
  box: { width: 10, height: 10, borderWidth: 1, borderColor: C.muted, borderRadius: 2 },

  grand: { flexDirection: 'row', justifyContent: 'space-between', borderRadius: 6, backgroundColor: C.accentBg, borderWidth: 1, borderColor: C.border, padding: 9, marginTop: 2 },
  grandLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  grandValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.accent },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 18, right: 32, fontSize: 7, color: C.muted },
});

export default function ShoppingListPDF({ data, store }: { data: ShoppingListPDFData | ShoppingListPDFData[]; store: StoreHeader }) {
  // Satu halaman-set per tanggal; beberapa tanggal digabung dalam satu file (tiap tanggal mulai di halaman baru).
  const days = Array.isArray(data) ? data : [data];
  return (
    <Document>
      {days.map((data, di) => (
      <Page key={di} size="A4" style={s.page}>
        <View style={s.topBar} />

        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {store.logo && <Image src={store.logo} style={s.logo} />}
            <View>
              <Text style={s.storeName}>{store.name}</Text>
              {store.tagline && <Text style={s.storeTagline}>{store.tagline}</Text>}
              {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>DAFTAR BELANJA</Text>
            <Text style={s.docSub}>Bahan Baku · Dokumen Internal</Text>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Tanggal:</Text>
              <Text style={s.docMetaValue}>{data.dateLabel}</Text>
            </View>
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Dicetak:</Text>
              <Text style={s.docMetaValue}>{data.generatedAt}</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Supplier</Text>
            <Text style={s.summaryValue}>{data.suppliers.length}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Item</Text>
            <Text style={s.summaryValue}>{data.itemCount}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Perkiraan Total</Text>
            <Text style={[s.summaryValue, { color: C.accent }]}>{rp(data.grandTotal)}</Text>
          </View>
        </View>

        {data.suppliers.map((sup, si) => (
          <View key={si} style={s.section}>
            <View style={s.supHead} wrap={false}>
              <View>
                <Text style={s.supName}>{si + 1}. {sup.name}</Text>
                {(sup.notes || sup.wallet !== '-') && (
                  <Text style={s.supMeta}>{[sup.notes, sup.wallet !== '-' ? `Dompet: ${sup.wallet}` : ''].filter(Boolean).join('  ·  ')}</Text>
                )}
              </View>
              <Text style={s.supStatus}>{sup.status}</Text>
            </View>
            <View style={s.table}>
              <View style={s.tHeadRow} wrap={false}>
                <Text style={[s.tHeadCell, s.colNo]}>No</Text>
                <Text style={[s.tHeadCell, s.colName]}>Bahan Baku</Text>
                <Text style={[s.tHeadCell, s.colQty]}>Qty</Text>
                <Text style={[s.tHeadCell, s.colUnit]}>Satuan</Text>
                <Text style={[s.tHeadCell, s.colPrice]}>Harga/satuan</Text>
                <Text style={[s.tHeadCell, s.colSub]}>Subtotal</Text>
                <Text style={[s.tHeadCell, s.colBought, { textAlign: 'center' }]}>Dibeli</Text>
              </View>
              {sup.items.map((it, ii) => (
                <View key={ii} style={[s.tRow, ...(ii % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
                  <Text style={[s.tCell, s.colNo]}>{it.no}</Text>
                  <Text style={[s.tCell, s.colName]}>{it.name}</Text>
                  <Text style={[s.tCell, s.colQty]}>{it.qty}</Text>
                  <Text style={[s.tCell, s.colUnit]}>{it.unit}</Text>
                  <Text style={[s.tCell, s.colPrice]}>{it.price != null ? rp(it.price) : '–'}</Text>
                  <Text style={[s.tCell, s.colSub]}>{it.price != null ? rp(it.subtotal) : '–'}</Text>
                  <View style={[s.colBought, { paddingVertical: 4.5 }]}>
                    {it.bought ? <Text style={{ fontSize: 7.5, color: C.green, fontFamily: 'Helvetica-Bold' }}>Sudah</Text> : <View style={s.box} />}
                  </View>
                </View>
              ))}
              <View style={s.totalsRow} wrap={false}>
                <Text style={[s.totalsCell, { width: '74%' }]}>Total {sup.name}</Text>
                <Text style={[s.totalsCell, s.colSub, { color: C.accent }]}>{rp(sup.total)}</Text>
                <Text style={[s.totalsCell, s.colBought]} />
              </View>
            </View>
          </View>
        ))}

        <View style={s.grand} wrap={false}>
          <Text style={s.grandLabel}>Total Semua Supplier ({data.suppliers.length} supplier · {data.itemCount} item)</Text>
          <Text style={s.grandValue}>{rp(data.grandTotal)}</Text>
        </View>

        <Text style={s.footer} fixed>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
      ))}
    </Document>
  );
}
