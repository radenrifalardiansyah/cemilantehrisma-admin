import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import { terbilangRupiah } from '@/lib/terbilang';
import type { StoreHeader } from './ShipmentNotePDF';

// Nota rekap bagi hasil Titip Jual untuk penitip (A4 portrait). Belum dibayar = "Nota Rekap"; sudah dibayar =
// "Bukti Pembayaran" lengkap dengan tanggal, metode, rekening, dan no. referensi. Hindari karakter di luar
// WinAnsi (font Helvetica standar react-pdf) — pakai "x" dan "-" biasa.
export interface SettlementNoteData {
  docNumber: string; status: 'unpaid' | 'paid'; createdAtText: string; periodText: string; stallName: string;
  consignor: { name: string; phone?: string; address?: string; bankName?: string; bankAccount?: string; bankHolder?: string };
  items: { name: string; qty: string; amount: number }[];
  totalQty: string; total: number; note?: string; createdBy?: string; printedAt: string;
  paid?: { dateText: string; method: string; from?: string; reference?: string; note?: string; paidBy?: string };
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

const C = { accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#A08468', border: '#E6DDD0', white: '#FFFFFF', ok: '#15803D', okBg: '#F0FDF4' };

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, paddingBottom: 56, fontSize: 10 },
  topBar: { height: 8, backgroundColor: C.accent, marginTop: -40, marginHorizontal: -40, marginBottom: 22 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 52, height: 52, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  storeName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.dark },
  storeTagline: { fontSize: 8.5, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', width: '42%', flexShrink: 0 },
  docTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.3, textAlign: 'right' },
  docSub: { fontSize: 8, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  badge: { marginTop: 6, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4, fontSize: 8.5, fontFamily: 'Helvetica-Bold' },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  grid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  box: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 9 },
  boxLabel: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  boxValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark },
  boxSub: { fontSize: 8.5, color: C.dark, marginTop: 2 },
  boxMuted: { fontSize: 8.5, color: C.muted, marginTop: 2 },

  table: { marginTop: 6, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 9, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 8 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 9.5, paddingVertical: 6, paddingHorizontal: 8, color: C.dark },
  colNo: { width: '8%', textAlign: 'center' },
  colName: { width: '52%' },
  colQty: { width: '15%', textAlign: 'right' },
  colAmt: { width: '25%', textAlign: 'right' },
  totalTableRow: { flexDirection: 'row', backgroundColor: C.dark, borderTopWidth: 1, borderTopColor: C.border },
  totalCell: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.white, paddingVertical: 7, paddingHorizontal: 8 },

  terbilang: { marginTop: 10, padding: 9, borderWidth: 1, borderColor: C.border, borderRadius: 6 },
  terbilangLabel: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  terbilangText: { fontSize: 9.5, fontFamily: 'Helvetica-Oblique', color: C.dark },

  payBox: { marginTop: 12, padding: 10, borderRadius: 6, backgroundColor: C.okBg, borderWidth: 1, borderColor: '#BBF7D0' },
  payTitle: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.ok, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  payRow: { flexDirection: 'row', marginBottom: 3 },
  payLabel: { width: '28%', fontSize: 9, color: C.muted },
  payValue: { width: '72%', fontSize: 9, color: C.dark },

  noteBox: { marginTop: 10, padding: 9, backgroundColor: C.accentBg, borderRadius: 6 },
  noteLabel: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', marginBottom: 3 },
  noteText: { fontSize: 9, color: C.dark },

  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 36 },
  signBox: { width: '30%', alignItems: 'center' },
  signLabel: { fontSize: 9, color: C.muted },
  signArea: { height: 54, width: '100%', position: 'relative', justifyContent: 'flex-end', alignItems: 'center' },
  signStamp: { position: 'absolute', bottom: 2, width: 46, height: 46, opacity: 0.85 },
  signImage: { position: 'absolute', bottom: 8, width: 74, height: 32, objectFit: 'contain' },
  signLine: { borderTopWidth: 1, borderTopColor: C.dark, width: '100%' },
  signName: { fontSize: 9, color: C.dark, marginTop: 4, textAlign: 'center' },
  signRole: { fontSize: 7.5, color: C.muted, textAlign: 'center' },

  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
  pageNo: { position: 'absolute', bottom: 22, right: 40, fontSize: 7.5, color: C.muted },
});

export default function SettlementNotePDF({ data, store }: { data: SettlementNoteData; store: StoreHeader }) {
  const paid = data.status === 'paid';
  const c = data.consignor;
  const hasBank = !!(c.bankName || c.bankAccount || c.bankHolder);
  return (
    <Document title={`${paid ? 'Bukti Pembayaran' : 'Nota Rekap'} ${data.docNumber}`}>
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
            <Text style={s.docTitle}>{paid ? 'BUKTI PEMBAYARAN BAGI HASIL' : 'NOTA REKAP BAGI HASIL'}</Text>
            <Text style={s.docSub}>Titip Jual</Text>
            <Text style={[s.badge, paid ? { color: C.ok, backgroundColor: C.okBg } : { color: C.accent, backgroundColor: C.accentBg }]}>
              {paid ? 'SUDAH DIBAYAR' : 'BELUM DIBAYAR'}
            </Text>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.grid}>
          <View style={s.box}><Text style={s.boxLabel}>No. Dokumen</Text><Text style={s.boxValue}>{data.docNumber}</Text></View>
          <View style={s.box}><Text style={s.boxLabel}>Tanggal Rekap</Text><Text style={s.boxValue}>{data.createdAtText}</Text></View>
          <View style={s.box}><Text style={s.boxLabel}>Periode Penjualan</Text><Text style={s.boxValue}>{data.periodText}</Text></View>
        </View>
        <View style={s.grid}>
          <View style={[s.box, { flex: 1.4 }]}>
            <Text style={s.boxLabel}>Penitip (Penerima Pembayaran)</Text>
            <Text style={s.boxValue}>{c.name}</Text>
            {c.phone && <Text style={s.boxSub}>Telp/WA: {c.phone}</Text>}
            {c.address && <Text style={s.boxMuted}>{c.address}</Text>}
            {hasBank && (
              <Text style={s.boxSub}>
                {[c.bankName, c.bankAccount, c.bankHolder ? `a.n. ${c.bankHolder}` : ''].filter(Boolean).join(' - ')}
              </Text>
            )}
          </View>
          <View style={s.box}>
            <Text style={s.boxLabel}>Lapak</Text>
            <Text style={s.boxValue}>{data.stallName}</Text>
            {data.createdBy ? <Text style={s.boxMuted}>Dibuat oleh {data.createdBy}</Text> : null}
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colName]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colQty]}>Terjual</Text>
            <Text style={[s.tHeadCell, s.colAmt]}>Bagian Penitip</Text>
          </View>
          {data.items.map((i, idx) => (
            <View key={idx} style={[s.tRow, ...(idx % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
              <Text style={[s.tCell, s.colNo]}>{idx + 1}</Text>
              <Text style={[s.tCell, s.colName]}>{i.name}</Text>
              <Text style={[s.tCell, s.colQty]}>{i.qty}</Text>
              <Text style={[s.tCell, s.colAmt]}>{rp(i.amount)}</Text>
            </View>
          ))}
          <View style={s.totalTableRow} wrap={false}>
            <Text style={[s.totalCell, s.colNo]} />
            <Text style={[s.totalCell, s.colName]}>TOTAL BAGIAN PENITIP</Text>
            <Text style={[s.totalCell, s.colQty]}>{data.totalQty}</Text>
            <Text style={[s.totalCell, s.colAmt]}>{rp(data.total)}</Text>
          </View>
        </View>

        <View style={s.terbilang} wrap={false}>
          <Text style={s.terbilangLabel}>Terbilang</Text>
          <Text style={s.terbilangText}>{terbilangRupiah(data.total)}</Text>
        </View>

        {paid && data.paid && (
          <View style={s.payBox} wrap={false}>
            <Text style={s.payTitle}>Rincian Pembayaran</Text>
            <View style={s.payRow}><Text style={s.payLabel}>Tanggal bayar</Text><Text style={s.payValue}>{data.paid.dateText}</Text></View>
            <View style={s.payRow}><Text style={s.payLabel}>Metode</Text><Text style={s.payValue}>{data.paid.method}</Text></View>
            {hasBank && data.paid.method === 'Transfer' && (
              <View style={s.payRow}><Text style={s.payLabel}>Rekening tujuan</Text><Text style={s.payValue}>{[c.bankName, c.bankAccount, c.bankHolder ? `a.n. ${c.bankHolder}` : ''].filter(Boolean).join(' - ')}</Text></View>
            )}
            {data.paid.from ? <View style={s.payRow}><Text style={s.payLabel}>Dari rekening/kas</Text><Text style={s.payValue}>{data.paid.from}</Text></View> : null}
            {data.paid.reference ? <View style={s.payRow}><Text style={s.payLabel}>No. referensi</Text><Text style={s.payValue}>{data.paid.reference}</Text></View> : null}
            {data.paid.paidBy ? <View style={s.payRow}><Text style={s.payLabel}>Dicatat oleh</Text><Text style={s.payValue}>{data.paid.paidBy}</Text></View> : null}
            {data.paid.note ? <View style={s.payRow}><Text style={s.payLabel}>Catatan bayar</Text><Text style={s.payValue}>{data.paid.note}</Text></View> : null}
          </View>
        )}

        {data.note ? (
          <View style={s.noteBox} wrap={false}>
            <Text style={s.noteLabel}>Catatan</Text>
            <Text style={s.noteText}>{data.note}</Text>
          </View>
        ) : null}

        <View style={s.signRow} wrap={false}>
          <View style={s.signBox}>
            <Text style={s.signLabel}>Dibuat oleh</Text>
            <View style={s.signArea}><View style={s.signLine} /></View>
            <Text style={s.signName}>{data.createdBy || 'Petugas'}</Text>
            <Text style={s.signRole}>{data.stallName}</Text>
          </View>
          <View style={s.signBox}>
            <Text style={s.signLabel}>{paid ? 'Yang Membayar' : 'Disetujui'}</Text>
            <View style={s.signArea}>
              {store.ownerStamp && <Image src={store.ownerStamp} style={s.signStamp} />}
              {store.ownerSignature && <Image src={store.ownerSignature} style={s.signImage} />}
              <View style={s.signLine} />
            </View>
            <Text style={s.signName}>{store.ownerName || store.name}</Text>
            <Text style={s.signRole}>Pemilik / Penanggung jawab</Text>
          </View>
          <View style={s.signBox}>
            <Text style={s.signLabel}>Penerima</Text>
            <View style={s.signArea}><View style={s.signLine} /></View>
            <Text style={s.signName}>{c.name}</Text>
            <Text style={s.signRole}>Penitip</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>Dokumen ini dibuat oleh sistem pada {data.printedAt} - {store.name} - {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => totalPages > 1 ? `${pageNumber} / ${totalPages}` : ''} fixed />
      </Page>
    </Document>
  );
}
