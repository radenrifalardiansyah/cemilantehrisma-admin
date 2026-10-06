import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import type { StoreHeader } from './ShipmentNotePDF';
import type { PoItem, GrItem } from '@/lib/purchase-orders-pg';

// Satu komponen untuk tiga dokumen Bahan Baku:
//  - 'po' : Purchase Order (dikirim ke supplier)
//  - 'gr' : Goods Receipt / Penerimaan Barang (qty dipesan vs diterima + harga, untuk arsip internal)
//  - 'do' : Delivery Order / surat penerimaan (tanpa harga, untuk tanda terima barang)
// Dipakai di browser (pdf().toBlob(), tanpa biaya server) dan di route publik PO (renderToBuffer).

export type PurchaseDocKind = 'po' | 'gr' | 'do';

export interface PurchaseDocData {
  kind: PurchaseDocKind;
  number: string;              // PO-…/GR-…/DO-…
  date: string;                // sudah terformat
  printedAt?: string;
  supplierName: string;
  supplierPhone?: string;
  refPoNumber?: string;        // GR/DO: PO asal
  refGrNumber?: string;        // DO: GR asal
  refDoNumber?: string;        // GR: nomor DO yang ikut terbuat
  expectedDate?: string;       // PO
  items: (PoItem | GrItem)[];
  total: number;
  note?: string;
  statusLabel?: string;        // mis. 'DRAFT', 'APPROVED', 'DIBATALKAN'
  statusTone?: 'ok' | 'warn' | 'void';
  cancelNote?: string;
}

export function formatDocDate(iso?: string | null) {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const C = {
  accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#A08468', border: '#E6DDD0', white: '#FFFFFF',
  green: '#15803D', greenBg: '#DCFCE7', amber: '#B45309', amberBg: '#FEF3C7', gray: '#6B7280', grayBg: '#F3F4F6',
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
  headerRight: { alignItems: 'flex-end', width: '42%', flexShrink: 0 },
  docTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.3, textAlign: 'right' },
  docNumber: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark, marginTop: 3, textAlign: 'right' },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 3 },
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
  right: { textAlign: 'right' },
  totalsWrap: { marginTop: 14, alignItems: 'flex-end' },
  totalsBox: { width: '48%', backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  totalsLine: { flexDirection: 'row', justifyContent: 'space-between' },
  totalsKey: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsVal: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent },
  noteBox: { marginTop: 14, padding: 10, backgroundColor: C.accentBg, borderRadius: 6 },
  noteLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', marginBottom: 3 },
  noteText: { fontSize: 9.5, color: C.dark },
  voidBox: { marginTop: 14, padding: 10, backgroundColor: C.grayBg, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  voidLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.gray, textTransform: 'uppercase' },
  voidText: { fontSize: 9, color: C.gray, marginTop: 3 },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 36, gap: 24 },
  signBox: { flex: 1, alignItems: 'center' },
  signLabel: { fontSize: 9, color: C.muted },
  signLine: { width: '80%', borderBottomWidth: 1, borderBottomColor: C.dark, marginTop: 48 },
  signName: { fontSize: 8.5, color: C.muted, marginTop: 3 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
});

const TITLE: Record<PurchaseDocKind, string> = {
  po: 'PURCHASE ORDER', gr: 'PENERIMAAN BARANG (GR)', do: 'SURAT PENERIMAAN (DO)',
};

const TONE = {
  ok:   { backgroundColor: C.greenBg, color: C.green },
  warn: { backgroundColor: C.amberBg, color: C.amber },
  void: { backgroundColor: C.grayBg, color: C.gray },
};

const qtyOf = (it: PoItem | GrItem) => `${it.qty} ${it.unit}`;
const orderedOf = (it: PoItem | GrItem) => ('orderedQty' in it ? `${it.orderedQty} ${it.unit}` : qtyOf(it));

export function PurchaseDocPage({ data, store }: { data: PurchaseDocData; store: StoreHeader }) {
  const k = data.kind;
  const showPrice = k !== 'do';
  const signLabels = k === 'po' ? ['Dibuat oleh', 'Disetujui supplier'] : ['Pengirim (supplier)', 'Penerima'];
  return (
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
          <Text style={s.docTitle}>{TITLE[k]}</Text>
          <Text style={s.docNumber}>{data.number}</Text>
          <View style={s.docMetaRow}>
            <Text style={s.docMetaLabel}>{k === 'po' ? 'Tanggal PO:' : 'Tanggal terima:'}</Text>
            <Text style={s.docMetaValue}>{data.date}</Text>
          </View>
          {k === 'po' && data.expectedDate && (
            <View style={s.docMetaRow}>
              <Text style={s.docMetaLabel}>Estimasi tiba:</Text>
              <Text style={s.docMetaValue}>{data.expectedDate}</Text>
            </View>
          )}
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
          {data.supplierPhone && <Text style={s.infoSub}>{data.supplierPhone}</Text>}
        </View>
        {k !== 'po' && (
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Referensi</Text>
            {data.refPoNumber && <Text style={s.infoValue}>PO: {data.refPoNumber}</Text>}
            {k === 'do' && data.refGrNumber && <Text style={s.infoSub}>GR: {data.refGrNumber}</Text>}
            {k === 'gr' && data.refDoNumber && <Text style={s.infoSub}>DO: {data.refDoNumber}</Text>}
            {data.statusLabel && (
              <Text style={[s.badge, TONE[data.statusTone ?? 'warn']]}>{data.statusLabel}</Text>
            )}
          </View>
        )}
      </View>

      <View style={s.table}>
        <View style={s.tHeadRow}>
          <Text style={[s.tHeadCell, { width: '8%' }]}>No</Text>
          <Text style={[s.tHeadCell, { width: showPrice ? (k === 'gr' ? '28%' : '38%') : '62%' }]}>Bahan Baku</Text>
          {k === 'gr' && <Text style={[s.tHeadCell, s.right, { width: '14%' }]}>Dipesan</Text>}
          <Text style={[s.tHeadCell, s.right, { width: showPrice ? (k === 'gr' ? '14%' : '16%') : '30%' }]}>{k === 'po' ? 'Qty' : 'Diterima'}</Text>
          {showPrice && <Text style={[s.tHeadCell, s.right, { width: k === 'gr' ? '18%' : '19%' }]}>Harga</Text>}
          {showPrice && <Text style={[s.tHeadCell, s.right, { width: k === 'gr' ? '18%' : '19%' }]}>Subtotal</Text>}
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]}>
            <Text style={[s.tCell, { width: '8%' }]}>{i + 1}</Text>
            <Text style={[s.tCell, { width: showPrice ? (k === 'gr' ? '28%' : '38%') : '62%' }]}>{it.materialName}</Text>
            {k === 'gr' && <Text style={[s.tCell, s.right, { width: '14%' }]}>{orderedOf(it)}</Text>}
            <Text style={[s.tCell, s.right, { width: showPrice ? (k === 'gr' ? '14%' : '16%') : '30%' }]}>{qtyOf(it)}</Text>
            {showPrice && <Text style={[s.tCell, s.right, { width: k === 'gr' ? '18%' : '19%' }]}>{rp(it.price)}</Text>}
            {showPrice && <Text style={[s.tCell, s.right, { width: k === 'gr' ? '18%' : '19%' }]}>{rp(it.subtotal)}</Text>}
          </View>
        ))}
      </View>

      {showPrice && (
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total</Text>
              <Text style={s.totalsVal}>{rp(data.total)}</Text>
            </View>
          </View>
        </View>
      )}

      {data.note && (
        <View style={s.noteBox}>
          <Text style={s.noteLabel}>Catatan</Text>
          <Text style={s.noteText}>{data.note}</Text>
        </View>
      )}

      {data.statusTone === 'void' && (
        <View style={s.voidBox}>
          <Text style={s.voidLabel}>Dokumen ini dibatalkan</Text>
          {data.cancelNote && <Text style={s.voidText}>Alasan: {data.cancelNote}</Text>}
        </View>
      )}

      <View style={s.signRow} wrap={false}>
        {signLabels.map(l => (
          <View key={l} style={s.signBox}>
            <Text style={s.signLabel}>{l}</Text>
            <View style={s.signLine} />
            <Text style={s.signName}>(                              )</Text>
          </View>
        ))}
      </View>

      <Text style={s.footer}>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
    </Page>
  );
}

export default function PurchaseDocPDF({ data, store }: { data: PurchaseDocData; store: StoreHeader }) {
  return (
    <Document>
      <PurchaseDocPage data={data} store={store} />
    </Document>
  );
}
