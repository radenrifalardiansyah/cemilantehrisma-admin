import { Fragment } from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import SystemSeal from './SystemSeal';
import type { StoreHeader } from './ShipmentNotePDF';
import { formatReportDay, type DailyProductRow, type MitraDailyReportSection } from '@/lib/mitra-daily-report';

export interface MitraDailyReportData {
  periodText:  string;
  generatedAt: string;
  sections:    (MitraDailyReportSection & { code?: string })[];
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const dash = (n: number) => (n ? String(n) : '-');
const dashRp = (n: number) => (n ? rp(n) : '-');
const pct = (n: number | null) => (n === null ? '-' : `${n.toLocaleString('id-ID')}%`);

// Gaya mengikuti PDF "Rekap Harian" di menu Mitra (RecapNotePDF): kop, kotak info, tabel dengan
// baris tanggal + subtotal, kotak total, dan tanda tangan.
const C = {
  accent:   THEME_COLOR,
  accentBg: '#FDF0E6',
  dark:     '#1E1008',
  muted:    '#A08468',
  border:   '#E6DDD0',
  white:    '#FFFFFF',
  green:    '#15803D',
  retur:    '#1D4ED8',
  returBg:  '#DBEAFE',
  reject:   '#B91C1C',
  rejectBg: '#FEE2E2',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, padding: 40, paddingBottom: 56, fontSize: 10 },
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
  docSub: { fontSize: 7.5, color: C.muted, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  docMetaRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  docMetaLabel: { fontSize: 8.5, color: C.muted },
  docMetaValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.dark },

  divider: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 14, marginBottom: 14 },

  infoRow: { flexDirection: 'row', gap: 16 },
  infoBox: { flex: 1, backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  infoLabel: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.dark },
  infoSub: { fontSize: 8.5, color: C.muted, marginTop: 3 },

  table: { marginTop: 18, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tHeadRow: { flexDirection: 'row', backgroundColor: C.accent },
  tHeadCell: { color: C.white, fontSize: 7, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 3 },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  tRowAlt: { backgroundColor: C.accentBg },
  tCell: { fontSize: 7.5, paddingVertical: 4, paddingHorizontal: 3, color: C.dark },
  right: { textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },

  returCell:  { color: C.retur, fontFamily: 'Helvetica-Bold', backgroundColor: C.returBg },
  rejectCell: { color: C.reject, fontFamily: 'Helvetica-Bold', backgroundColor: C.rejectBg },
  zeroCell:   { color: C.muted },

  sectionRow:          { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 4, paddingHorizontal: 6 },
  sectionRowText:      { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.accent },
  sectionRowSub:       { fontSize: 7.5, color: C.muted },
  totalRow: { flexDirection: 'row', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border },

  totalsWrap: { marginTop: 14, alignItems: 'flex-end' },
  totalsBox: { width: '66%', backgroundColor: C.accentBg, borderRadius: 6, padding: 10 },
  totalsLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  totalsKey: { fontSize: 9, color: C.muted },
  totalsVal: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  totalsFinalKey: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.dark },
  totalsFinalVal: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent },

  signRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 24 },
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

// Lebar kolom (% dari lebar tabel) — total 100.
const W = { no: '4%', name: '15%', harga: '9%', qty: '5%', qtyL: '6%', rp: '11.5%', stok: '7%' };

function ProductRows({ rows }: { rows: DailyProductRow[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <View key={r.productId} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
          <Text style={[s.tCell, { width: W.no }]}>{i + 1}</Text>
          <Text style={[s.tCell, { width: W.name }]}>{r.productName}</Text>
          <Text style={[s.tCell, s.right, { width: W.harga }]}>{dashRp(r.harga)}</Text>
          <Text style={[s.tCell, s.right, { width: W.qty }]}>{dash(r.kirim)}</Text>
          <Text style={[s.tCell, s.right, { width: W.rp }]}>{dashRp(r.nilaiKirim)}</Text>
          <Text style={[s.tCell, s.right, { width: W.qty }]}>{dash(r.jual)}</Text>
          <Text style={[s.tCell, s.right, { width: W.rp }]}>{dashRp(r.nilaiJual)}</Text>
          <Text style={[s.tCell, s.right, { width: W.qtyL }, ...(r.retur > 0 ? [s.returCell] : [s.zeroCell])]}>{r.retur}</Text>
          <Text style={[s.tCell, s.right, { width: W.qtyL }, ...(r.reject > 0 ? [s.rejectCell] : [s.zeroCell])]}>{r.reject}</Text>
          <Text style={[s.tCell, s.right, { width: W.rp }, ...(r.selisih < 0 ? [{ color: C.reject }] : [])]}>{r.selisih ? rp(r.selisih) : '-'}</Text>
          <Text style={[s.tCell, s.right, { width: W.stok }]}>{r.stokAwal}</Text>
          <Text style={[s.tCell, s.right, s.bold, { width: W.stok }]}>{r.stokAkhir}</Text>
        </View>
      ))}
    </>
  );
}

// Baris subtotal/total: angka sejajar tepat di bawah kolomnya masing-masing.
function TotalRow({ rows, label }: { rows: DailyProductRow[]; label: string }) {
  const sum = (k: 'kirim' | 'nilaiKirim' | 'jual' | 'nilaiJual' | 'retur' | 'reject' | 'stokAwal' | 'stokAkhir') => rows.reduce((t, r) => t + r[k], 0);
  const selisih = sum('nilaiKirim') - sum('nilaiJual');
  return (
    <View style={s.totalRow} wrap={false}>
      <Text style={[s.tCell, { width: W.no }]} />
      <Text style={[s.tCell, s.bold, { width: W.name }]}>{label}</Text>
      <Text style={[s.tCell, { width: W.harga }]} />
      <Text style={[s.tCell, s.right, s.bold, { width: W.qty }]}>{sum('kirim')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.rp }]}>{rp(sum('nilaiKirim'))}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.qty }]}>{sum('jual')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.rp }]}>{rp(sum('nilaiJual'))}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.qtyL }, ...(sum('retur') > 0 ? [{ color: C.retur }] : [])]}>{sum('retur')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.qtyL }, ...(sum('reject') > 0 ? [{ color: C.reject }] : [])]}>{sum('reject')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.rp }, ...(selisih < 0 ? [{ color: C.reject }] : [])]}>{rp(selisih)}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.stok }]}>{sum('stokAwal')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.stok }]}>{sum('stokAkhir')}</Text>
    </View>
  );
}

function Header({ store, data }: { store: StoreHeader; data: MitraDailyReportData }) {
  return (
    <>
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
          <Text style={s.docTitle}>LAPORAN HARIAN MITRA</Text>
          <Text style={s.docSub}>Dokumen Internal</Text>
          <View style={s.docMetaRow}>
            <Text style={s.docMetaLabel}>Periode:</Text>
            <Text style={s.docMetaValue}>{data.periodText}</Text>
          </View>
          <View style={s.docMetaRow}>
            <Text style={s.docMetaLabel}>Dicetak:</Text>
            <Text style={s.docMetaValue}>{data.generatedAt}</Text>
          </View>
        </View>
      </View>
      <View style={s.divider} />
    </>
  );
}

function Footer({ store }: { store: StoreHeader }) {
  return (
    <>
      <Text style={s.footer} fixed>Dokumen ini dibuat otomatis oleh sistem — {store.name} · {SITE_URL}</Text>
      <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </>
  );
}

function Signature({ store, periodText }: { store: StoreHeader; periodText: string }) {
  return (
    <View style={s.signRow}>
      <View style={s.signBox}>
        <Text style={s.signLabel}>Mengetahui,</Text>
        <View style={s.signArea}>
          {store.ownerStamp && <Image src={store.ownerStamp} style={s.signStamp} />}
          {store.ownerSignature && <Image src={store.ownerSignature} style={s.signImage} />}
          {!store.ownerStamp && !store.ownerSignature && <SystemSeal title="DICETAK SECARA SISTEM" sub={periodText} />}
          <View style={s.signLine} />
        </View>
        <Text style={s.signName}>{store.ownerName || store.name}</Text>
      </View>
    </View>
  );
}

// Ringkasan semua mitra — halaman pertama bila laporan memuat lebih dari satu mitra.
const OV = { no: '6%', name: '28%', rp: '16%', pct: '9%', stok: '9%' };
function OverviewPage({ data, store }: { data: MitraDailyReportData; store: StoreHeader }) {
  const t = data.sections.reduce((a, x) => ({
    kirim: a.kirim + x.totals.nilaiKirim, jual: a.jual + x.totals.nilaiJual, stok: a.stok + x.currentStock,
  }), { kirim: 0, jual: 0, stok: 0 });
  const head: [string, string, boolean][] = [
    ['No', OV.no, false], ['Mitra', OV.name, false], ['Total Kirim', OV.rp, true], ['Total Rekap', OV.rp, true],
    ['Selisih', OV.rp, true], ['% Real.', OV.pct, true], ['Stok', OV.stok, true],
  ];
  return (
    <Page size="A4" style={s.page} wrap>
      <Header store={store} data={data} />
      <View style={s.infoRow}>
        <View style={s.infoBox}>
          <Text style={s.infoLabel}>Ringkasan</Text>
          <Text style={s.infoValue}>{data.sections.length} mitra</Text>
          <Text style={s.infoSub}>Periode {data.periodText}</Text>
        </View>
      </View>
      <View style={s.table}>
        <View style={s.tHeadRow} fixed>
          {head.map(([h, w, r]) => <Text key={h} style={[s.tHeadCell, { width: w }, ...(r ? [s.right] : [])]}>{h}</Text>)}
        </View>
        {data.sections.map((x, i) => (
          <View key={x.locationId} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
            <Text style={[s.tCell, { width: OV.no }]}>{i + 1}</Text>
            <Text style={[s.tCell, { width: OV.name }]}>{x.locationName}</Text>
            <Text style={[s.tCell, s.right, { width: OV.rp }]}>{dashRp(x.totals.nilaiKirim)}</Text>
            <Text style={[s.tCell, s.right, { width: OV.rp }]}>{dashRp(x.totals.nilaiJual)}</Text>
            <Text style={[s.tCell, s.right, { width: OV.rp }, ...(x.totals.selisih < 0 ? [{ color: C.reject }] : [])]}>{x.totals.selisih ? rp(x.totals.selisih) : '-'}</Text>
            <Text style={[s.tCell, s.right, { width: OV.pct }]}>{pct(x.realisasiPct)}</Text>
            <Text style={[s.tCell, s.right, s.bold, { width: OV.stok }]}>{x.currentStock}</Text>
          </View>
        ))}
        <View style={[s.tRow, { backgroundColor: C.accentBg }]} wrap={false}>
          <Text style={[s.tCell, { width: OV.no }]} />
          <Text style={[s.tCell, s.bold, { width: OV.name }]}>Total</Text>
          <Text style={[s.tCell, s.right, s.bold, { width: OV.rp }]}>{rp(t.kirim)}</Text>
          <Text style={[s.tCell, s.right, s.bold, { width: OV.rp }]}>{rp(t.jual)}</Text>
          <Text style={[s.tCell, s.right, s.bold, { width: OV.rp }]}>{rp(t.kirim - t.jual)}</Text>
          <Text style={[s.tCell, s.right, s.bold, { width: OV.pct }]}>{pct(t.kirim > 0 ? Math.round((t.jual / t.kirim) * 1000) / 10 : null)}</Text>
          <Text style={[s.tCell, s.right, s.bold, { width: OV.stok }]}>{t.stok}</Text>
        </View>
      </View>
      <Footer store={store} />
    </Page>
  );
}

function MitraPage({ sec, data, store, no }: { sec: MitraDailyReportData['sections'][number]; data: MitraDailyReportData; store: StoreHeader; no?: number }) {
  const showPeriodSummary = sec.days.length > 1; // satu hari saja = ringkasan periode sama dengan rinciannya
  const valOf = (pick: (r: DailyProductRow) => number) => sec.products.reduce((t, r) => t + pick(r) * r.harga, 0);
  return (
    <Page size="A4" style={s.page} wrap>
      <Header store={store} data={data} />

      <View style={s.infoRow}>
        <View style={s.infoBox}>
          <Text style={s.infoLabel}>Lokasi / Mitra</Text>
          <Text style={s.infoValue}>{no ? `${no}. ` : ''}{sec.locationName}{sec.code ? `  ·  ${sec.code}` : ''}</Text>
          <Text style={s.infoSub}>{sec.days.length} hari ada aktivitas · {sec.products.length} produk</Text>
        </View>
        <View style={s.infoBox}>
          <Text style={s.infoLabel}>Stok Mitra</Text>
          <Text style={s.infoValue}>Awal {sec.stokAwalPeriode} | Akhir {sec.stokAkhirPeriode} pcs</Text>
          <Text style={s.infoSub}>Saat ini {sec.currentStock} pcs · {rp(sec.currentStockValue)} · terealisasi {pct(sec.realisasiPct)}</Text>
        </View>
      </View>

      {sec.days.length === 0 ? (
        <View style={s.table}>
          <Text style={[s.tCell, { padding: 12, color: C.muted }]}>Tidak ada kirim maupun rekap pada periode ini.</Text>
        </View>
      ) : (
        <View style={s.table}>
          <View style={s.tHeadRow} fixed>
            <Text style={[s.tHeadCell, { width: W.no }]}>No</Text>
            <Text style={[s.tHeadCell, { width: W.name }]}>Produk</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.harga }]}>{'Harga\nSatuan'}</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.qty }]}>Kirim</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.rp }]}>Nilai Kirim</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.qty }]}>Rekap</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.rp }]}>Nilai Rekap</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.qtyL, backgroundColor: C.retur }]}>Retur</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.qtyL, backgroundColor: C.reject }]}>Reject</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.rp }]}>Selisih</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.stok }]}>{'Stok\nAwal'}</Text>
            <Text style={[s.tHeadCell, s.right, { width: W.stok }]}>{'Stok\nAkhir'}</Text>
          </View>

          {showPeriodSummary && (
            <Fragment>
              <View style={s.sectionRow} wrap={false} minPresenceAhead={50}>
                <Text style={s.sectionRowText}>Ringkasan produk selama periode</Text>
                <Text style={s.sectionRowSub}>stok awal = awal periode · stok akhir = akhir periode</Text>
              </View>
              <ProductRows rows={sec.products} />
              <TotalRow rows={sec.products} label="Total periode" />
            </Fragment>
          )}

          {sec.days.map(day => (
            <Fragment key={day.date}>
              <View style={s.sectionRow} wrap={false} minPresenceAhead={50}>
                <Text style={s.sectionRowText}>{formatReportDay(day.date)}</Text>
                <Text style={s.sectionRowSub}>stok awal {day.totals.stokAwal} | akhir {day.totals.stokAkhir} pcs</Text>
              </View>
              <ProductRows rows={day.rows} />
              <TotalRow rows={day.rows} label="Subtotal" />
            </Fragment>
          ))}
        </View>
      )}

      <View wrap={false}>
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total Kirim</Text>
              <Text style={s.totalsVal}>{sec.totals.kirim} pcs  ·  {rp(sec.totals.nilaiKirim)}</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Total Rekap (terjual)</Text>
              <Text style={[s.totalsVal, { color: C.green }]}>{sec.totals.jual} pcs  ·  {rp(sec.totals.nilaiJual)}</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={[s.totalsKey, { color: C.retur }]}>Total Retur</Text>
              <Text style={[s.totalsVal, { color: C.retur }]}>{sec.totals.retur} pcs  ·  {rp(valOf(r => r.retur))}</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={[s.totalsKey, { color: C.reject }]}>Total Reject</Text>
              <Text style={[s.totalsVal, { color: C.reject }]}>{sec.totals.reject} pcs  ·  {rp(valOf(r => r.reject))}</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>% Terealisasi (rekap / kirim)</Text>
              <Text style={s.totalsVal}>{pct(sec.realisasiPct)}</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Stok Awal Periode</Text>
              <Text style={s.totalsVal}>{sec.stokAwalPeriode} pcs</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Stok Akhir Periode</Text>
              <Text style={s.totalsVal}>{sec.stokAkhirPeriode} pcs</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsKey}>Stok Saat Ini</Text>
              <Text style={s.totalsVal}>{sec.currentStock} pcs  ·  {rp(sec.currentStockValue)}</Text>
            </View>
            <View style={s.totalsFinalLine}>
              <Text style={s.totalsFinalKey}>Selisih (Kirim - Rekap)</Text>
              <Text style={[s.totalsFinalVal, ...(sec.totals.selisih < 0 ? [{ color: C.reject }] : [])]}>{rp(sec.totals.selisih)}</Text>
            </View>
          </View>
        </View>
        <Signature store={store} periodText={data.periodText} />
      </View>

      <Footer store={store} />
    </Page>
  );
}

export default function MitraDailyReportPDF({ data, store }: { data: MitraDailyReportData; store: StoreHeader }) {
  const multi = data.sections.length > 1;
  return (
    <Document>
      {multi && <OverviewPage data={data} store={store} />}
      {data.sections.map((sec, i) => (
        <MitraPage key={sec.locationId} sec={sec} data={data} store={store} no={multi ? i + 1 : undefined} />
      ))}
    </Document>
  );
}
