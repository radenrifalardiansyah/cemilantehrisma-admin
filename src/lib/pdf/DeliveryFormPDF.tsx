import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';

// Formulir kosong "Daftar Pengiriman Produk" — 6 lembar per halaman A4 (2 kolom × 3 baris),
// dicetak lalu digunting; Mitra, Tanggal, dan isi tabel diisi tangan oleh kurir saat antar.
const COPIES = 6;
const ROWS   = 5;
const BORDER = 0.8;
const JML_W  = 52; // lebar kolom Jml; kotak Total memakai lebar yang sama + 2 garis tepi

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
  logo:      { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: '#FCD34D', objectFit: 'cover', marginRight: 8 },
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
  tr:       { flexDirection: 'row', height: 22 },
  trBorder: { borderTopWidth: 0.8, borderTopColor: C.line },
  thead:    { backgroundColor: '#FDF0E6' },
  cNo:      { width: '11%', borderRightWidth: 0.8, borderRightColor: C.line, justifyContent: 'center' },
  cMenu:    { flexGrow: 1, flexBasis: 0, borderRightWidth: 0.8, borderRightColor: C.line, justifyContent: 'center' },
  cJml:     { width: JML_W, justifyContent: 'center' },
  tText:    { fontSize: 8.5, textAlign: 'center' },

  // Kotak Total menempel di bawah kolom Jml (berbagi garis tepi dengan tabel) — tanpa jarak vertikal.
  bottom:     { flexDirection: 'row', alignItems: 'center' },
  paraf:      { fontSize: 9, flexGrow: 1 },
  totalLabel: { fontSize: 9, marginRight: 6 },
  totalBox:   { width: JML_W + 2 * BORDER, height: 22, borderLeftWidth: BORDER, borderRightWidth: BORDER, borderBottomWidth: BORDER, borderColor: C.line },

  footer:     { marginTop: 'auto', borderTopWidth: 0.5, borderTopColor: C.cut, paddingTop: 4, flexDirection: 'row', alignItems: 'center' },
  footerInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0, marginRight: 6 },
  footerText: { fontSize: 6.5, color: C.muted, lineHeight: 1.35 },
  footerLine: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
  footerLink: { fontSize: 6.5, color: C.accent, fontFamily: 'Helvetica-Oblique', marginLeft: 8 },
  qr:         { width: 34, height: 34 },
});

function Form({ store, qr, index }: { store: StoreHeader; qr?: string; index: number }) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  const [brandTop, ...rest] = store.name.split(' ');
  const brandBottom = rest.join(' ');
  return (
    <View style={[s.cell, col === 0 ? { borderRightWidth: 0.6 } : {}, row < 2 ? { borderBottomWidth: 0.6 } : {}]}>
      <View style={s.logoRow}>
        {store.logo && <Image src={store.logo} style={s.logo} />}
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
        <View style={s.footerInfo}>
          {store.address ? <Text style={s.footerText}>{store.address}</Text> : null}
          <View style={s.footerLine}>
            {store.phone ? <Text style={s.footerText}>WhatsApp {store.phone}</Text> : null}
            <Text style={store.phone ? s.footerLink : [s.footerLink, { marginLeft: 0 }]}>{SITE_URL}</Text>
          </View>
        </View>
        {qr ? <Image src={qr} style={s.qr} /> : null}
      </View>
    </View>
  );
}

// `qr` = data-URI PNG QR code yang mengarah ke SITE_URL (dibuat oleh pemanggil, lihat makeStoreQr).
export default function DeliveryFormPDF({ store, qr }: { store: StoreHeader; qr?: string }) {
  return (
    <Document title={`Daftar Pengiriman Produk — ${store.name}`}>
      <Page size="A4" style={s.page}>
        {Array.from({ length: COPIES }, (_, i) => <Form key={i} store={store} qr={qr} index={i} />)}
      </Page>
    </Document>
  );
}
