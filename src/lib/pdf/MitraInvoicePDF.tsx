import { Fragment } from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import { terbilangRupiah } from '@/lib/terbilang';
import SystemSeal from './SystemSeal';
import type { StoreHeader } from './ShipmentNotePDF';
import type { RecapNoteItem } from './RecapNotePDF';

// Invoice tagihan ke mitra konsinyasi (A4 portrait): ringkasan kirim & rekap, rincian rekap yang
// belum dibayar, lalu total yang harus dibayar. Hindari karakter di luar WinAnsi (Helvetica standar).
export interface MitraInvoiceRecap {
  date: string; docNo: string; items: RecapNoteItem[];
  totalSold: number; totalRetur: number; totalReject: number; totalRevenue: number;
}

export interface MitraInvoiceData {
  docNo: string; date: string; printedAt: string; periodText: string;
  locationName: string; locationCode?: string; contactName?: string; contactPhone?: string; address?: string;
  shipmentCount: number; shipmentQty: number; shipmentValue: number;
  recapCount: number; soldQty: number; returQty: number; rejectQty: number; revenueAll: number;
  paidValue: number; paidCount: number;
  unpaid: MitraInvoiceRecap[]; // rekap belum lunas, urut tanggal
  total: number;               // total tagihan = jumlah pendapatan rekap belum lunas
  bank?: { name: string; accountNumber: string; accountHolder?: string };
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

const C = {
  accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#A08468', border: '#E6DDD0', white: '#FFFFFF',
  green: '#15803D', greenBg: '#DCFCE7', amber: '#B45309', amberBg: '#FEF3C7',
  retur: '#1D4ED8', returBg: '#DBEAFE', reject: '#B91C1C', rejectBg: '#FEE2E2',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, paddingBottom: 56, fontSize: 10 },
  topBar: { height: 8, backgroundColor: C.accent, marginTop: -40, marginHorizontal: -40, marginBottom: 22 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  logo: { width: 52, height: 52, borderRadius: 8, objectFit: 'contain', borderWidth: 1, borderColor: C.border, backgroundColor: C.white, flexShrink: 0 },
  storeInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  storeName: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  storeTagline: { fontSize: 8.5, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', width: '40%', flexShrink: 0 },
  docTitle: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 1, textAlign: 'right' },
  metaRow: { flexDirection: 'row', gap: 4, marginTop: 3 },
  metaLabel: { fontSize: 8.5, color: C.muted },
  metaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoRow: { flexDirection: 'row', gap: 12 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold' },
  infoSub: { fontSize: 9, color: C.muted, marginTop: 2 },

  sumWrap: { marginTop: 12, borderWidth: 1, borderColor: C.border, borderRadius: 6, overflow: 'hidden' },
  sumHead: { backgroundColor: C.accent, color: C.white, fontSize: 9, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 8 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: C.border },
  sumKey: { fontSize: 9.5 },
  sumVal: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },

  secTitle: { marginTop: 16, marginBottom: 6, fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.accent },
  table: { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tCell: { fontSize: 9, paddingVertical: 4, paddingHorizontal: 6 },
  colNo: { width: '6%' }, colName: { width: '30%' },
  colSold: { width: '12%', textAlign: 'right' }, colRetur: { width: '12%', textAlign: 'right' }, colReject: { width: '12%', textAlign: 'right' },
  colPrice: { width: '13%', textAlign: 'right' }, colRev: { width: '15%', textAlign: 'right' },
  returCell: { color: C.retur, fontFamily: 'Helvetica-Bold', backgroundColor: C.returBg },
  rejectCell: { color: C.reject, fontFamily: 'Helvetica-Bold', backgroundColor: C.rejectBg },
  zeroCell: { color: C.muted },
  groupRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 4, paddingHorizontal: 6 },
  groupText: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.accent },
  groupDoc: { fontSize: 7.5, color: C.muted },
  subRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 3, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: C.border },
  subText: { fontSize: 8, color: C.muted },
  empty: { padding: 12, fontSize: 9.5, color: C.green, textAlign: 'center' },

  totalsWrap: { marginTop: 14, alignItems: 'flex-end' },
  totalsBox: { width: '62%', backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  totalsLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  totalsKey: { fontSize: 9, color: C.muted },
  totalsVal: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  totalsFinal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  totalsFinalKey: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  totalsFinalVal: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.accent },
  terbilang: { marginTop: 8, padding: 8, borderWidth: 1, borderColor: C.border, borderRadius: 6 },
  terbilangLabel: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', marginBottom: 2 },
  terbilangText: { fontSize: 9.5, fontFamily: 'Helvetica-Oblique' },
  bankBox: { marginTop: 8, padding: 9, backgroundColor: C.amberBg, borderRadius: 6 },
  bankLabel: { fontSize: 8, color: C.amber, textTransform: 'uppercase', marginBottom: 3 },
  bankLine: { fontSize: 9.5, marginTop: 1 },
  bankNumber: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 2 },

  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  signBox: { width: '42%', alignItems: 'center' },
  signLabel: { fontSize: 9, color: C.muted },
  signArea: { height: 54, width: '100%', position: 'relative', justifyContent: 'flex-end', alignItems: 'center' },
  signStamp: { position: 'absolute', bottom: 2, width: 46, height: 46, opacity: 0.85 },
  signImage: { position: 'absolute', bottom: 8, width: 74, height: 32, objectFit: 'contain' },
  signLine: { borderTopWidth: 1, borderTopColor: C.dark, width: '100%' },
  signName: { fontSize: 9, color: C.muted, marginTop: 4 },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7.5, color: C.muted },
  pageNo: { position: 'absolute', bottom: 24, right: 40, fontSize: 7.5, color: C.muted },
});

export default function MitraInvoicePDF({ data, store }: { data: MitraInvoiceData; store: StoreHeader }) {
  const sisa = data.shipmentQty - data.soldQty - data.returQty - data.rejectQty;
  const unpaidQty = data.unpaid.reduce((q, r) => q + r.totalSold, 0);
  const isPaidOff = data.total <= 0;
  return (
    <Document title={`Invoice ${data.docNo} - ${data.locationName}`}>
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
            <Text style={s.docTitle}>INVOICE</Text>
            <View style={s.metaRow}><Text style={s.metaLabel}>No:</Text><Text style={s.metaValue}>{data.docNo}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Tanggal:</Text><Text style={s.metaValue}>{data.date}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Periode:</Text><Text style={s.metaValue}>{data.periodText}</Text></View>
          </View>
        </View>
        <View style={s.divider} />

        <View style={s.infoRow}>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Ditagihkan Kepada</Text>
            <Text style={s.infoValue}>{data.locationName}{data.locationCode ? `  ·  ${data.locationCode}` : ''}</Text>
            {data.contactName && <Text style={s.infoSub}>{data.contactName}</Text>}
            {data.contactPhone && <Text style={s.infoSub}>{data.contactPhone}</Text>}
            {data.address && <Text style={s.infoSub}>{data.address}</Text>}
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>Status Tagihan</Text>
            <Text style={[s.infoValue, { color: isPaidOff ? C.green : C.amber }]}>{isPaidOff ? 'LUNAS' : 'BELUM LUNAS'}</Text>
            <Text style={s.infoSub}>{data.unpaid.length} rekap belum dibayar</Text>
            <Text style={s.infoSub}>{data.paidCount} rekap sudah lunas</Text>
          </View>
        </View>

        <View style={s.sumWrap} wrap={false}>
          <Text style={s.sumHead}>RINGKASAN KONSINYASI</Text>
          <View style={s.sumRow}><Text style={s.sumKey}>Dikirim ({data.shipmentCount} pengiriman)</Text><Text style={s.sumVal}>{data.shipmentQty} pcs  ·  {rp(data.shipmentValue)}</Text></View>
          <View style={s.sumRow}><Text style={s.sumKey}>Terjual ({data.recapCount} rekap)</Text><Text style={s.sumVal}>{data.soldQty} pcs  ·  {rp(data.revenueAll)}</Text></View>
          <View style={s.sumRow}><Text style={[s.sumKey, { color: C.retur }]}>Retur</Text><Text style={[s.sumVal, { color: C.retur }]}>{data.returQty} pcs</Text></View>
          <View style={s.sumRow}><Text style={[s.sumKey, { color: C.reject }]}>Reject</Text><Text style={[s.sumVal, { color: C.reject }]}>{data.rejectQty} pcs</Text></View>
          <View style={s.sumRow}><Text style={s.sumKey}>Sisa stok di mitra (kirim - jual - retur - reject)</Text><Text style={s.sumVal}>{sisa} pcs</Text></View>
        </View>

        <Text style={s.secTitle}>RINCIAN YANG HARUS DIBAYAR ({data.unpaid.length} REKAP)</Text>
        <View style={s.table}>
          <View style={s.tHeadRow} fixed>
            <Text style={[s.tHeadCell, s.colNo]}>No</Text>
            <Text style={[s.tHeadCell, s.colName]}>Produk</Text>
            <Text style={[s.tHeadCell, s.colSold]}>Terjual</Text>
            <Text style={[s.tHeadCell, s.colRetur, { backgroundColor: C.retur }]}>Retur</Text>
            <Text style={[s.tHeadCell, s.colReject, { backgroundColor: C.reject }]}>Reject</Text>
            <Text style={[s.tHeadCell, s.colPrice]}>Harga</Text>
            <Text style={[s.tHeadCell, s.colRev]}>Tagihan</Text>
          </View>
          {data.unpaid.length === 0 && <Text style={s.empty}>Semua rekap sudah lunas. Tidak ada tagihan.</Text>}
          {data.unpaid.map((r, ri) => (
            <Fragment key={ri}>
              <View style={s.groupRow} wrap={false} minPresenceAhead={50}>
                <Text style={s.groupText}>{r.date}</Text>
                <Text style={s.groupDoc}>No: {r.docNo}</Text>
              </View>
              {r.items.map((it, i) => (
                <View key={i} style={s.tRow} wrap={false}>
                  <Text style={[s.tCell, s.colNo]}>{i + 1}</Text>
                  <Text style={[s.tCell, s.colName]}>{it.productName}</Text>
                  <Text style={[s.tCell, s.colSold]}>{it.qtySold}</Text>
                  <Text style={[s.tCell, s.colRetur, ...(it.qtyRetur > 0 ? [s.returCell] : [s.zeroCell])]}>{it.qtyRetur}</Text>
                  <Text style={[s.tCell, s.colReject, ...(it.qtyReject > 0 ? [s.rejectCell] : [s.zeroCell])]}>{it.qtyReject}</Text>
                  <Text style={[s.tCell, s.colPrice]}>{rp(it.hargaTitip)}</Text>
                  <Text style={[s.tCell, s.colRev]}>{rp(it.revenue)}</Text>
                </View>
              ))}
              <View style={s.subRow} wrap={false}>
                <Text style={s.subText}>Subtotal: jual {r.totalSold}, retur {r.totalRetur}, reject {r.totalReject}  ·  {rp(r.totalRevenue)}</Text>
              </View>
            </Fragment>
          ))}
        </View>

        <View wrap={false}>
          <View style={s.totalsWrap}>
            <View style={s.totalsBox}>
              <View style={s.totalsLine}><Text style={s.totalsKey}>Total nilai penjualan (semua rekap)</Text><Text style={s.totalsVal}>{rp(data.revenueAll)}</Text></View>
              <View style={s.totalsLine}><Text style={s.totalsKey}>Sudah dibayar ({data.paidCount} rekap lunas)</Text><Text style={[s.totalsVal, { color: C.green }]}>- {rp(data.paidValue)}</Text></View>
              <View style={s.totalsLine}><Text style={s.totalsKey}>Barang terjual belum dibayar</Text><Text style={s.totalsVal}>{unpaidQty} pcs</Text></View>
              <View style={s.totalsFinal}>
                <Text style={s.totalsFinalKey}>TOTAL YANG HARUS DIBAYAR</Text>
                <Text style={s.totalsFinalVal}>{rp(data.total)}</Text>
              </View>
            </View>
          </View>

          {data.total > 0 && (
            <View style={s.terbilang}>
              <Text style={s.terbilangLabel}>Terbilang</Text>
              <Text style={s.terbilangText}>{terbilangRupiah(data.total)}</Text>
            </View>
          )}

          {data.total > 0 && data.bank?.accountNumber && (
            <View style={s.bankBox}>
              <Text style={s.bankLabel}>Pembayaran via Transfer</Text>
              <Text style={s.bankLine}>{data.bank.name}</Text>
              <Text style={s.bankNumber}>{data.bank.accountNumber}</Text>
              {data.bank.accountHolder && <Text style={s.bankLine}>a.n. {data.bank.accountHolder}</Text>}
              <Text style={[s.bankLine, { color: C.muted, fontSize: 8.5 }]}>Mohon transfer sebesar {rp(data.total)} dan kirim bukti transfer.</Text>
            </View>
          )}

          <View style={s.signRow}>
            <View style={s.signBox}>
              <Text style={s.signLabel}>Hormat kami,</Text>
              <View style={s.signArea}>
                {store.ownerStamp && <Image src={store.ownerStamp} style={s.signStamp} />}
                {store.ownerSignature && <Image src={store.ownerSignature} style={s.signImage} />}
                {!store.ownerStamp && !store.ownerSignature && <SystemSeal title="DITERBITKAN SISTEM" sub={data.date} />}
                <View style={s.signLine} />
              </View>
              <Text style={s.signName}>{store.ownerName || store.name}</Text>
            </View>
            <View style={s.signBox}>
              <Text style={s.signLabel}>Diterima oleh,</Text>
              <View style={s.signArea}><View style={s.signLine} /></View>
              <Text style={s.signName}>{data.locationName}</Text>
            </View>
          </View>
        </View>

        <Text style={s.footer} fixed>Invoice ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
        <Text style={s.pageNo} render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${pageNumber} / ${totalPages}` : '')} fixed />
      </Page>
    </Document>
  );
}
