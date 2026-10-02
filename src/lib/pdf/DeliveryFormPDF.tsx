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

  logoRow: { alignItems: 'center' },
  logo:    { width: 38, height: 38, objectFit: 'contain' },
  brand:   { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.accent, marginTop: 2 },
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

  bottom:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  paraf:      { fontSize: 9 },
  totalWrap:  { flexDirection: 'row', alignItems: 'center' },
  totalLabel: { fontSize: 9, marginRight: 6 },
  totalBox:   { width: '58pt', height: 15, borderWidth: 0.8, borderColor: C.line },

  footer:     { marginTop: 'auto', borderTopWidth: 0.5, borderTopColor: C.cut, paddingTop: 3, alignItems: 'center' },
  footerText: { fontSize: 6.5, color: C.muted, textAlign: 'center', lineHeight: 1.35 },
  footerLink: { fontSize: 6.5, color: C.accent, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
});

function Form({ store, index }: { store: StoreHeader; index: number }) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  const site = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const contact = [store.phone && `WhatsApp ${store.phone}`, site].filter(Boolean).join('  |  ');
  return (
    <View style={[s.cell, col === 0 ? { borderRightWidth: 0.6 } : {}, row < 2 ? { borderBottomWidth: 0.6 } : {}]}>
      <View style={s.logoRow}>
        {store.logo ? <Image src={store.logo} style={s.logo} /> : <Text style={s.brand}>{store.name}</Text>}
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
        <View style={s.totalWrap}>
          <Text style={s.totalLabel}>Total</Text>
          <View style={s.totalBox} />
        </View>
      </View>

      <View style={s.footer}>
        <Text style={s.footerText}>{store.name}{store.address ? ` — ${store.address}` : ''}</Text>
        {contact ? <Text style={s.footerLink}>{contact}</Text> : null}
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
