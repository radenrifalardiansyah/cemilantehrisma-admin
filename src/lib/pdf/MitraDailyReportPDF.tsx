import { Fragment } from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import SystemSeal from './SystemSeal';
import type { StoreHeader } from './ShipmentNotePDF';
import { describePeriod, formatReportDay, type DailyProductRow, type MitraDailyReportSection } from '@/lib/mitra-daily-report';

export interface MitraDailyReportData {
  from:        string; // YYYY-MM-DD (WIB)
  to:          string;
  generatedAt: string;
  summaryOnly?: boolean; // true = hanya ringkasan (tanpa rincian per hari)
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
  subTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.accent, marginTop: 16, marginBottom: -8 },
  summaryBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.dark, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 10, marginTop: 22 },
  summaryBannerTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white, letterSpacing: 0.8 },
  summaryBannerSub: { fontSize: 8, color: '#E6DDD0' },
  totalRow: { flexDirection: 'row', backgroundColor: C.accentBg, borderTopWidth: 1, borderTopColor: C.border },

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
const W = { no: '4%', name: '13.5%', harga: '8.8%', qty: '6.2%', qtyL: '6%', rp: '11.5%', stok: '7%' };

function ProductRows({ rows }: { rows: DailyProductRow[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <View key={r.productId} style={[s.tRow, ...(i % 2 === 1 ? [s.tRowAlt] : [])]} wrap={false}>
          <Text style={[s.tCell, { width: W.no }]}>{i + 1}</Text>
          <Text style={[s.tCell, { width: W.name }]}>{r.productName}</Text>
          <Text style={[s.tCell, s.right, { width: W.stok }]}>{r.stokAwal}</Text>
          <Text style={[s.tCell, s.right, { width: W.harga }]}>{dashRp(r.harga)}</Text>
          <Text style={[s.tCell, s.right, { width: W.qty }]}>{dash(r.kirim)}</Text>
          <Text style={[s.tCell, s.right, { width: W.rp }]}>{dashRp(r.nilaiKirim)}</Text>
          <Text style={[s.tCell, s.right, { width: W.qty }]}>{dash(r.jual)}</Text>
          <Text style={[s.tCell, s.right, { width: W.rp }]}>{dashRp(r.nilaiJual)}</Text>
          <Text style={[s.tCell, s.right, { width: W.qtyL }, ...(r.retur > 0 ? [s.returCell] : [s.zeroCell])]}>{r.retur}</Text>
          <Text style={[s.tCell, s.right, { width: W.qtyL }, ...(r.reject > 0 ? [s.rejectCell] : [s.zeroCell])]}>{r.reject}</Text>
          <Text style={[s.tCell, s.right, { width: W.rp }, ...(r.selisih < 0 ? [{ color: C.reject }] : [])]}>{r.selisih ? rp(r.selisih) : '-'}</Text>
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
      <Text style={[s.tCell, s.right, s.bold, { width: W.stok }]}>{sum('stokAwal')}</Text>
      <Text style={[s.tCell, { width: W.harga }]} />
      <Text style={[s.tCell, s.right, s.bold, { width: W.qty }]}>{sum('kirim')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.rp }]}>{rp(sum('nilaiKirim'))}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.qty }]}>{sum('jual')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.rp }]}>{rp(sum('nilaiJual'))}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.qtyL }, ...(sum('retur') > 0 ? [{ color: C.retur }] : [])]}>{sum('retur')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.qtyL }, ...(sum('reject') > 0 ? [{ color: C.reject }] : [])]}>{sum('reject')}</Text>
      <Text style={[s.tCell, s.right, s.bold, { width: W.rp }, ...(selisih < 0 ? [{ color: C.reject }] : [])]}>{rp(selisih)}</Text>
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
            <Text style={s.docMetaValue}>{describePeriod(data.from, data.to).text}</Text>
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

function PeriodBox({ data }: { data: MitraDailyReportData }) {
  const p = describePeriod(data.from, data.to);
  return (
    <View style={s.infoBox}>
      <Text style={s.infoLabel}>Periode Laporan</Text>
      <Text style={s.infoValue}>Dari: {p.fromLong}</Text>
      <Text style={s.infoValue}>Sampai: {p.toLong}</Text>
      <Text style={s.infoSub}>Lama periode: {p.days} hari</Text>
    </View>
  );
}

// Penanda bagian ringkasan — memisahkannya dari rincian harian di atasnya.
function SummaryBanner({ title, sub, first }: { title: string; sub: string; first?: boolean }) {
  return (
    <View style={[s.summaryBanner, ...(first ? [{ marginTop: 4 }] : [])]} wrap={false} minPresenceAhead={90}>
      <Text style={s.summaryBannerTitle}>{title}</Text>
      <Text style={s.summaryBannerSub}>{sub}</Text>
    </View>
  );
}

function TableHead() {
  return (
    <View style={s.tHeadRow} fixed>
      <Text style={[s.tHeadCell, { width: W.no }]}>No</Text>
      <Text style={[s.tHeadCell, { width: W.name }]}>Produk</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.stok }]}>{'Stok\nAwal'}</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.harga }]}>{'Harga\nSatuan'}</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.qty }]}>Kirim</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.rp }]}>Nilai Kirim</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.qty }]}>Terjual</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.rp }]}>{'Nilai\nTerjual'}</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.qtyL, backgroundColor: C.retur }]}>Retur</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.qtyL, backgroundColor: C.reject }]}>Reject</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.rp }]}>Selisih</Text>
      <Text style={[s.tHeadCell, s.right, { width: W.stok }]}>{'Stok\nAkhir'}</Text>
    </View>
  );
}

// Ringkasan semua mitra — halaman terakhir bila laporan memuat lebih dari satu mitra.
const OV = { no: '6%', name: '28%', rp: '16%', pct: '9%', stok: '9%' };
function OverviewPage({ data, store }: { data: MitraDailyReportData; store: StoreHeader }) {
  const t = data.sections.reduce((a, x) => ({
    kirim: a.kirim + x.totals.nilaiKirim, jual: a.jual + x.totals.nilaiJual, stok: a.stok + x.currentStock,
  }), { kirim: 0, jual: 0, stok: 0 });
  const head: [string, string, boolean][] = [
    ['No', OV.no, false], ['Mitra', OV.name, false], ['Total Kirim', OV.rp, true], ['Total Terjual', OV.rp, true],
    ['Selisih', OV.rp, true], ['% Real.', OV.pct, true], ['Stok', OV.stok, true],
  ];
  return (
    <Page size="A4" style={s.page} wrap>
      <Header store={store} data={data} />
      <View style={s.infoRow}>
        <View style={s.infoBox}>
          <Text style={s.infoLabel}>Isi Laporan</Text>
          <Text style={s.infoValue}>{data.sections.length} mitra</Text>
          <Text style={s.infoSub}>{data.summaryOnly ? 'Hanya ringkasan (tanpa rincian per hari)' : 'Rincian per mitra ada di halaman sebelumnya'}</Text>
        </View>
        <PeriodBox data={data} />
      </View>
      <SummaryBanner title="RINGKASAN SEMUA MITRA" sub={describePeriod(data.from, data.to).text} />
      <View style={[s.table, { marginTop: 10 }]}>
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
  const period = describePeriod(data.from, data.to);
  // Satu hari saja = rekap produk periode sama dengan rinciannya, kecuali memang diminta ringkasan saja.
  const showProductSummary = sec.days.length > 0 && (sec.days.length > 1 || !!data.summaryOnly);
  return (
    <Page size="A4" style={s.page} wrap>
      <Header store={store} data={data} />

      <View style={s.infoRow}>
        <View style={s.infoBox}>
          <Text style={s.infoLabel}>Lokasi / Mitra</Text>
          <Text style={s.infoValue}>{no ? `${no}. ` : ''}{sec.locationName}{sec.code ? `  ·  ${sec.code}` : ''}</Text>
          <Text style={s.infoSub}>{sec.days.length} hari ada aktivitas · {sec.products.length} produk</Text>
        </View>
        <PeriodBox data={data} />
      </View>

      {/* Rincian per hari */}
      {!data.summaryOnly && <Text style={s.subTitle}>Rincian per hari</Text>}
      {data.summaryOnly ? null : sec.days.length === 0 ? (
        <View style={s.table}>
          <Text style={[s.tCell, { padding: 12, color: C.muted }]}>Tidak ada kirim maupun rekap pada periode ini.</Text>
        </View>
      ) : (
        <View style={s.table}>
          <TableHead />
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

      {/* Ringkasan — bagian terpisah di paling bawah */}
      {data.summaryOnly && sec.days.length === 0 && (
        <View style={s.table}>
          <Text style={[s.tCell, { padding: 12, color: C.muted }]}>Tidak ada kirim maupun rekap pada periode ini.</Text>
        </View>
      )}
      {showProductSummary && (
        <SummaryBanner title={`RINGKASAN${no ? ` · ${no}. ` : ' · '}${sec.locationName.toUpperCase()}`} sub={period.text} first={!!data.summaryOnly} />
      )}
      {showProductSummary && (
        <View style={[s.table, { marginTop: 10 }]}>
          <TableHead />
          <View style={s.sectionRow} wrap={false}>
            <Text style={s.sectionRowText}>Produk selama periode</Text>
            <Text style={s.sectionRowSub}>stok awal = awal periode | stok akhir = akhir periode</Text>
          </View>
          <ProductRows rows={sec.products} />
          <TotalRow rows={sec.products} label="Total periode" />
        </View>
      )}

      <View wrap={false}>
        <Signature store={store} periodText={period.text} />
      </View>

      <Footer store={store} />
    </Page>
  );
}

export default function MitraDailyReportPDF({ data, store }: { data: MitraDailyReportData; store: StoreHeader }) {
  const multi = data.sections.length > 1;
  return (
    <Document>
      {/* Ringkasan saja: banyak mitra = satu halaman ringkasan; satu mitra = halamannya tanpa rincian harian */}
      {!(data.summaryOnly && multi) && data.sections.map((sec, i) => (
        <MitraPage key={sec.locationId} sec={sec} data={data} store={store} no={multi ? i + 1 : undefined} />
      ))}
      {multi && <OverviewPage data={data} store={store} />}
    </Document>
  );
}
