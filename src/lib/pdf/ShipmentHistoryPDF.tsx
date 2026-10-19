import { Fragment } from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader, ShipmentNoteItem } from './ShipmentNotePDF';
import SystemSeal from './SystemSeal';

// Rekap riwayat kirim stok konsinyasi (portrait): satu blok per pengiriman berisi rincian produk
// + subtotal, ditutup total keseluruhan dan tanda tangan.
export interface ShipmentHistoryGroup {
  date: string;
  locationName: string;
  warehouseName?: string;
  note?: string;
  items: ShipmentNoteItem[];
  total: number;
}

export interface ShipmentHistoryData {
  label: string;
  generatedAt: string;
  groups: ShipmentHistoryGroup[];
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const C = { accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#A08468', border: '#E6DDD0', white: '#FFFFFF' };

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 36, paddingBottom: 48, fontSize: 9 },
  topBar: { height: 7, backgroundColor: C.accent, marginTop: -36, marginHorizontal: -36, marginBottom: 18 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 44, height: 44, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  storeName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  storeTagline: { fontSize: 8, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8, color: C.muted, marginTop: 1 },
  headerRight: { alignItems: 'flex-end', width: '42%', flexShrink: 0 },
  docTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent, textAlign: 'right' },
  docMeta: { fontSize: 8, color: C.muted, marginTop: 3, textAlign: 'right' },
  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 10, marginBottom: 12 },

  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tCell: { fontSize: 9, paddingVertical: 4.5, paddingHorizontal: 6 },
  colNo: { width: '7%' },
  colName: { width: '43%' },
  colQty: { width: '12%', textAlign: 'right' },
  colPrice: { width: '19%', textAlign: 'right' },
  colSub: { width: '19%', textAlign: 'right' },

  groupRow: { backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 5, paddingHorizontal: 6 },
  groupTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.accent },
  groupMeta: { fontSize: 7.5, color: C.muted, marginTop: 1 },
  subtotalRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: C.border },
  subtotalText: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  grandRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.dark, paddingVertical: 7, paddingHorizontal: 8 },
  grandText: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.white },

  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 32 },
  signBox: { width: '42%', alignItems: 'center' },
  signLabel: { fontSize: 9, color: C.muted },
  signArea: { height: 54, width: '100%', position: 'relative', justifyContent: 'flex-end', alignItems: 'center' },
  signStamp: { position: 'absolute', bottom: 2, width: 46, height: 46, opacity: 0.85 },
  signImage: { position: 'absolute', bottom: 8, width: 74, height: 32, objectFit: 'contain' },
  signLine: { borderTopWidth: 1, borderTopColor: C.dark, width: '100%' },
  signName: { fontSize: 9, color: C.muted, marginTop: 4 },

  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, textAlign: 'center', fontSize: 7, color: C.muted },
  pageNo: { position: 'absolute', bottom: 20, right: 36, fontSize: 7, color: C.muted },
});

export default function ShipmentHistoryPDF({ data, store }: { data: ShipmentHistoryData; store: StoreHeader }) {
  const grandTotal = data.groups.reduce((sum, g) => sum + g.total, 0);
  const grandQty = data.groups.reduce((sum, g) => sum + g.items.reduce((q, it) => q + it.qty, 0), 0);
  return (
    <Document title="Rekap Kirim Stok Konsinyasi">
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
            <Text style={s.docTitle}>REKAP KIRIM KONSINYASI</Text>
            <Text style={s.docMeta}>{data.groups.length} pengiriman ({data.label})</Text>
            <Text style={s.docMeta}>Dicetak: {data.generatedAt}</Text>
          </View>
        </View>
        <View style={s.divider} />

        <View style={s.table}>
          <View style={s.tHeadRow} fixed>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colName]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colQty]}>Qty</Text>
            <Text style={[s.tHeadCell, s.colPrice]}>Harga Titip</Text>
            <Text style={[s.tHeadCell, s.colSub]}>Subtotal</Text>
          </View>
          {data.groups.map((g, gi) => (
            <Fragment key={gi}>
              <View style={s.groupRow} wrap={false} minPresenceAhead={40}>
                <Text style={s.groupTitle}>{g.date}  ·  {g.locationName}</Text>
                {(g.warehouseName || g.note) && (
                  <Text style={s.groupMeta}>
                    {[g.warehouseName ? `Gudang: ${g.warehouseName}` : '', g.note ? `Catatan: ${g.note}` : ''].filter(Boolean).join('  ·  ')}
                  </Text>
                )}
              </View>
              {g.items.map((it, i) => (
                <View key={i} style={s.tRow} wrap={false}>
                  <Text style={[s.tCell, s.colNo]}>{i + 1}</Text>
                  <Text style={[s.tCell, s.colName]}>{it.productName}</Text>
                  <Text style={[s.tCell, s.colQty]}>{it.qty} pcs</Text>
                  <Text style={[s.tCell, s.colPrice]}>{rp(it.hargaTitip)}</Text>
                  <Text style={[s.tCell, s.colSub]}>{rp(it.subtotal)}</Text>
                </View>
              ))}
              <View style={s.subtotalRow} wrap={false}>
                <Text style={s.subtotalText}>Subtotal: {rp(g.total)}</Text>
              </View>
            </Fragment>
          ))}
          <View style={s.grandRow} wrap={false}>
            <Text style={s.grandText}>TOTAL KESELURUHAN ({grandQty} pcs)</Text>
            <Text style={s.grandText}>{rp(grandTotal)}</Text>
          </View>
        </View>

        <View style={s.signRow} wrap={false}>
          <View style={s.signBox}>
            <Text style={s.signLabel}>Dibuat Oleh</Text>
            <View style={s.signArea}>
              {store.ownerStamp && <Image src={store.ownerStamp} style={s.signStamp} />}
              {store.ownerSignature && <Image src={store.ownerSignature} style={s.signImage} />}
              {!store.ownerStamp && !store.ownerSignature && <SystemSeal title="DICATAT SISTEM" sub={data.generatedAt} />}
              <View style={s.signLine} />
            </View>
            <Text style={s.signName}>{store.ownerName || store.name}</Text>
          </View>
          <View style={s.signBox}>
            <Text style={s.signLabel}>Mengetahui</Text>
            <View style={s.signArea}><View style={s.signLine} /></View>
            <Text style={s.signName}>(                              )</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
