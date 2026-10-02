import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

// Formulir kosong "Daftar Pengiriman Produk" — 6 lembar per halaman A4 (2 kolom × 3 baris),
// dicetak lalu digunting; Mitra, Tanggal, dan isi tabel diisi tangan oleh kurir saat antar.
const COPIES = 6;
const ROWS   = 5;

const C = {
  accent: THEME_COLOR,
  dark:   '#1E1008',
  muted:  '#8A7560',
  line:   '#1E1008',
  cut:    '#B8B0A6',
};

const s = StyleSheet.create({
  page: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#FFFFFF', fontFamily: 'Helvetica', color: C.dark },
  cell: { width: '50%', height: '33.3333%', paddingHorizontal: 22, paddingTop: 14, paddingBottom: 10, borderColor: C.cut, borderStyle: 'dashed' },

  logoRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  logoRing:  { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#F6D77A', backgroundColor: '#FFFFFF', overflow: 'hidden', marginRight: 8 },
  logo:      { width: 36, height: 36, objectFit: 'cover' },
  brandBox:  { justifyContent: 'center' },
  brand1:    { fontSize: 13, fontFamily: 'Times-Bold', color: '#7A3F1A', lineHeight: 1.05 },
  brand2:    { fontSize: 13, fontFamily: 'Times-Bold', color: '#D4891E', lineHeight: 1.05 },
  title:   { fontSize: 10.5, fontFamily: 'Helvetica-Bold', textAlign: 'center', textDecoration: 'underline', marginTop: 4 },

  metaRow:   { flexDirection: 'row', marginTop: 7 },
  metaMitra: { flexDirection: 'row', flexGrow: 1, flexBasis: 0, marginRight: 8 },
  metaTgl:   { flexDirection: 'row', width: '38%' },
  metaLabel: { fontSize: 9 },
  metaLine:  { flexGrow: 1, borderBottomWidth: 0.5, borderBottomColor: C.line, marginLeft: 3, marginBottom: 2 },

  table:    { marginTop: 5, borderWidth: 0.8, borderColor: C.line },
  tr:       { flexDirection: 'row', height: 24 },
  trBorder: { borderTopWidth: 0.8, borderTopColor: C.line },
  thead:    { backgroundColor: '#FDF0E6' },
  cNo:      { width: '11%', borderRightWidth: 0.8, borderRightColor: C.line, justifyContent: 'center' },
  cMenu:    { flexGrow: 1, flexBasis: 0, borderRightWidth: 0.8, borderRightColor: C.line, justifyContent: 'center' },
  cJml:     { width: '20%', justifyContent: 'center' },
  tText:    { fontSize: 8.5, textAlign: 'center' },

  // Kotak Total menempel di bawah kolom Jml (berbagi garis tepi dengan tabel) — tanpa jarak vertikal.
  bottom:     { flexDirection: 'row', alignItems: 'center' },
  paraf:      { fontSize: 9, flexGrow: 1 },
  totalLabel: { fontSize: 9, marginRight: 6 },
  totalBox:   { width: '20%', height: 22, borderLeftWidth: 0.8, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: C.line },

  footer:     { marginTop: 'auto', borderTopWidth: 0.5, borderTopColor: C.cut, paddingTop: 3, alignItems: 'center' },
  footerText: { fontSize: 6.5, color: C.muted, textAlign: 'center', lineHeight: 1.35 },
  footerLink: { fontSize: 6.5, color: C.accent, fontFamily: 'Helvetica-Oblique', textAlign: 'center' },
});

function Form({ store, index }: { store: StoreHeader; index: number }) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  const [brandTop, ...rest] = store.name.split(' ');
  const brandBottom = rest.join(' ');
  return (
    <View style={[s.cell, col === 0 ? { borderRightWidth: 0.6 } : {}, row < 2 ? { borderBottomWidth: 0.6 } : {}]}>
      <View style={s.logoRow}>
        {store.logo && <View style={s.logoRing}><Image src={store.logo} style={s.logo} /></View>}
        <View style={s.brandBox}>
          <Text style={s.brand1}>{brandTop}</Text>
          {brandBottom ? <Text style={s.brand2}>{brandBottom}</Text> : null}
        </View>
      </View>
      <Text style={s.title}>DAFTAR PENGIRIMAN PRODUK</Text>

      <View style={s.metaRow}>
        <View style={s.metaMitra}><Text style={s.metaLabel}>Mitra :</Text><View style={s.metaLine} /></View>
        <View style={s.metaTgl}><Text style={s.metaLabel}>Tgl :</Text><View style={s.metaLine} /></View>
      </View>

      <View style={s.table}>
        <View style={[s.tr, s.thead]}>
          <View style={s.cNo}><Text style={s.tText}>No</Text></View>
          <View style={s.cMenu}><Text style={s.tText}>Menu</Text></View>
          <View style={s.cJml}><Text style={s.tText}>Jml</Text></View>
        </View>
        {Array.from({ length: ROWS }, (_, i) => (
          <View key={i} style={[s.tr, s.trBorder]}>
            <View style={s.cNo}><Text style={s.tText}>{i + 1}</Text></View>
            <View style={s.cMenu} />
            <View style={s.cJml} />
          </View>
        ))}
      </View>

      <View style={s.bottom}>
        <Text style={s.paraf}>Paraf :</Text>
        <Text style={s.totalLabel}>Total</Text>
        <View style={s.totalBox} />
      </View>

      <View style={s.footer}>
        {store.address ? <Text style={s.footerText}>{store.address}</Text> : null}
        {store.phone ? <Text style={s.footerText}>WhatsApp {store.phone}</Text> : null}
        <Text style={s.footerLink}>{SITE_URL}</Text>
      </View>
    </View>
  );
}

export default function DeliveryFormPDF({ store }: { store: StoreHeader }) {
  return (
    <Document title={`Daftar Pengiriman Produk — ${store.name}`}>
      <Page size="A4" style={s.page}>
        {Array.from({ length: COPIES }, (_, i) => <Form key={i} store={store} index={i} />)}
      </Page>
    </Document>
  );
}
