import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { THEME_COLOR, SITE_URL } from '@/lib/branding';
import { terbilangRupiah } from '@/lib/terbilang';
import type { StoreHeader } from './ShipmentNotePDF';
import type { PoItem, GrItem } from '@/lib/purchase-orders-pg';

// Tiga dokumen Bahan Baku dengan tata letak dokumen bisnis (kop surat, para pihak, tabel rinci,
// terbilang, syarat, tanda tangan, nomor halaman):
//  - 'po' : Purchase Order — dikirim ke supplier
//  - 'gr' : Goods Receipt / Penerimaan Barang — qty dipesan vs diterima, harga, sisa PO (arsip internal)
//  - 'do' : Delivery Order / Surat Penerimaan — tanpa harga, untuk tanda terima barang di lokasi
// Dipakai di browser (pdf().toBlob(), tanpa biaya server) dan di route publik PO (renderToBuffer).
// Font standar PDF (Helvetica) hanya punya glyph WinAnsi — jangan pakai panah/emoji di teks.

export type PurchaseDocKind = 'po' | 'gr' | 'do';

export interface PurchaseDocData {
  kind: PurchaseDocKind;
  number: string;              // PO-…/GR-…/DO-…
  date: string;                // sudah terformat
  printedAt?: string;
  supplierName: string;
  supplierPhone?: string;
  supplierAddress?: string;
  refPoNumber?: string;        // GR/DO: PO asal
  refGrNumber?: string;        // DO: GR asal
  refDoNumber?: string;        // GR: nomor DO yang ikut terbuat
  expectedDate?: string;       // PO
  createdBy?: string;
  approvedBy?: string;         // GR/DO
  approvedAt?: string;         // GR/DO (sudah terformat)
  paymentLabel?: string;       // GR approved: 'Lunas' / 'Belum Lunas'
  items: (PoItem | GrItem)[];
  total: number;
  note?: string;
  statusLabel?: string;        // mis. 'DRAFT', 'APPROVED', 'DIBATALKAN'
  statusTone?: 'ok' | 'warn' | 'void';
  cancelNote?: string;
}

export function formatDocDate(iso?: string | null) {
  if (!iso) return '–';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

const rp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const qty = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

const C = {
  accent: THEME_COLOR, accentBg: '#FDF0E6', dark: '#1E1008', muted: '#8A7058', border: '#D9CFC2', line: '#EBE3D8', white: '#FFFFFF',
  green: '#15803D', greenBg: '#DCFCE7', amber: '#B45309', amberBg: '#FEF3C7', gray: '#6B7280', grayBg: '#F3F4F6', red: '#B91C1C',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.dark, paddingTop: 0, paddingBottom: 64, paddingHorizontal: 34, fontSize: 9 },
  topBar: { height: 7, backgroundColor: C.accent, marginHorizontal: -34, marginBottom: 20 },

  // Kop
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 12 },
  logo: { width: 50, height: 50, borderRadius: 6, objectFit: 'contain', borderWidth: 1, borderColor: C.line, backgroundColor: C.white },
  storeName: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  storeTag: { fontSize: 8, color: C.accent, marginTop: 1 },
  storeMeta: { fontSize: 8, color: C.muted, marginTop: 2, lineHeight: 1.3 },
  docBox: { width: '40%', alignItems: 'flex-end', flexShrink: 0 },
  docTitle: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: C.accent, letterSpacing: 0.4, textAlign: 'right' },
  docSub: { fontSize: 8, color: C.muted, textAlign: 'right', marginTop: 1 },
  docNumber: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 5, textAlign: 'right' },
  badge: { borderRadius: 3, paddingVertical: 2.5, paddingHorizontal: 7, fontSize: 7.5, fontFamily: 'Helvetica-Bold', marginTop: 5 },
  rule: { borderBottomWidth: 1.5, borderBottomColor: C.accent, marginTop: 12, marginBottom: 12 },

  // Para pihak
  parties: { flexDirection: 'row', gap: 10 },
  box: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 4 },
  boxWide: { flex: 1.35, borderWidth: 1, borderColor: C.border, borderRadius: 4 },
  boxHead: { backgroundColor: C.accentBg, paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  boxHeadText: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.accent, textTransform: 'uppercase', letterSpacing: 0.6 },
  boxBody: { padding: 8 },
  strong: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  line: { fontSize: 8.5, color: C.dark, marginTop: 2, lineHeight: 1.35 },
  dim: { fontSize: 8.5, color: C.muted, marginTop: 2, lineHeight: 1.35 },
  kv: { flexDirection: 'row', marginTop: 2.5 },
  k: { width: '34%', fontSize: 8.5, color: C.muted },
  v: { width: '66%', fontSize: 8.5, fontFamily: 'Helvetica-Bold' },

  // Tabel
  table: { marginTop: 14, borderWidth: 1, borderColor: C.border },
  th: { flexDirection: 'row', backgroundColor: C.accent },
  thCell: { color: C.white, fontSize: 8, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 6 },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, minHeight: 20 },
  trAlt: { backgroundColor: '#FBF7F2' },
  td: { fontSize: 9, paddingVertical: 5, paddingHorizontal: 6 },
  tdBorder: { borderLeftWidth: 1, borderLeftColor: C.line },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },

  // Total
  summary: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, gap: 14 },
  words: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 4, padding: 8, alignSelf: 'flex-start' },
  wordsLabel: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  wordsText: { fontSize: 9, fontFamily: 'Helvetica-Oblique', lineHeight: 1.4, textTransform: 'capitalize' },
  totals: { width: '42%', borderWidth: 1, borderColor: C.border, borderRadius: 4 },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4.5, paddingHorizontal: 8 },
  totKey: { fontSize: 9, color: C.muted },
  totVal: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  grand: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.accent, paddingVertical: 7, paddingHorizontal: 8 },
  grandKey: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white },
  grandVal: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: C.white },

  // Catatan / ketentuan
  twoCol: { flexDirection: 'row', gap: 10, marginTop: 12 },
  note: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 4, padding: 8 },
  noteHead: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  noteText: { fontSize: 8.5, lineHeight: 1.45 },
  voidBox: { marginTop: 12, padding: 8, backgroundColor: C.grayBg, borderRadius: 4, borderWidth: 1, borderColor: C.border },

  // Tanda tangan
  sigRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, gap: 14 },
  sigBox: { flex: 1, alignItems: 'center' },
  sigRole: { fontSize: 8.5, color: C.muted },
  sigSpace: { height: 52 },
  sigLine: { width: '86%', borderBottomWidth: 1, borderBottomColor: C.dark },
  sigName: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginTop: 4, textAlign: 'center' },
  sigMeta: { fontSize: 7.5, color: C.muted, marginTop: 1.5, textAlign: 'center' },

  // Cap status & footer
  stamp: { position: 'absolute', top: 330, left: 90, width: 420, textAlign: 'center', fontSize: 64, fontFamily: 'Helvetica-Bold', opacity: 0.07, transform: 'rotate(-28deg)' },
  footer: { position: 'absolute', bottom: 22, left: 34, right: 34, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  footText: { fontSize: 7.5, color: C.muted },
});

const TITLE: Record<PurchaseDocKind, { main: string; sub: string }> = {
  po: { main: 'PURCHASE ORDER', sub: 'Pesanan Pembelian Bahan Baku' },
  gr: { main: 'GOODS RECEIPT', sub: 'Penerimaan Barang (GR)' },
  do: { main: 'DELIVERY ORDER', sub: 'Surat Penerimaan / Surat Jalan' },
};
const TONE = {
  ok: { backgroundColor: C.greenBg, color: C.green }, warn: { backgroundColor: C.amberBg, color: C.amber }, void: { backgroundColor: C.grayBg, color: C.gray },
};
const TERMS: Record<PurchaseDocKind, string[]> = {
  po: [
    'Mohon konfirmasi penerimaan PO ini beserta kesanggupan jadwal pengiriman.',
    'Barang harus sesuai nama, jumlah, dan spesifikasi yang tercantum pada PO ini.',
    'Cantumkan nomor PO pada surat jalan dan faktur penagihan.',
    'Barang yang tidak sesuai atau rusak dapat dikembalikan dan dikoreksi pada penagihan.',
  ],
  gr: [
    'Penerimaan dihitung dari barang yang benar-benar diterima dan diperiksa saat kedatangan.',
    'Sisa PO yang belum diterima tetap terbuka dan dapat dikirim pada penerimaan berikutnya.',
    'Dokumen ini menjadi dasar pencatatan stok dan pembayaran setelah disetujui.',
  ],
  do: [
    'Periksa jumlah dan kondisi barang pada saat serah terima.',
    'Keberatan atas jumlah/kondisi barang harap dicatat pada kolom keterangan sebelum menandatangani.',
  ],
};

function Field({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return <View style={s.kv}><Text style={s.k}>{k}</Text><Text style={s.v}>{v}</Text></View>;
}

function Head({ data, store }: { data: PurchaseDocData; store: StoreHeader }) {
  const t = TITLE[data.kind];
  return (
    <>
      <View style={s.headRow}>
        <View style={s.brand}>
          {store.logo && <Image src={store.logo} style={s.logo} />}
          <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
            <Text style={s.storeName}>{store.name}</Text>
            {store.tagline && <Text style={s.storeTag}>{store.tagline}</Text>}
            {store.address && <Text style={s.storeMeta}>{store.address}</Text>}
            {store.phone && <Text style={s.storeMeta}>Telp/WA: {store.phone}</Text>}
          </View>
        </View>
        <View style={s.docBox}>
          <Text style={s.docTitle}>{t.main}</Text>
          <Text style={s.docSub}>{t.sub}</Text>
          <Text style={s.docNumber}>No. {data.number}</Text>
          {data.statusLabel && <Text style={[s.badge, TONE[data.statusTone ?? 'warn']]}>{data.statusLabel}</Text>}
        </View>
      </View>
      <View style={s.rule} />
    </>
  );
}

function Parties({ data, store }: { data: PurchaseDocData; store: StoreHeader }) {
  const k = data.kind;
  return (
    <View style={s.parties}>
      <View style={s.box}>
        <View style={s.boxHead}><Text style={s.boxHeadText}>{k === 'po' ? 'Kepada (Supplier)' : 'Dari (Supplier)'}</Text></View>
        <View style={s.boxBody}>
          <Text style={s.strong}>{data.supplierName || 'Tanpa nama'}</Text>
          {data.supplierAddress && <Text style={s.line}>{data.supplierAddress}</Text>}
          {data.supplierPhone && <Text style={s.dim}>Telp/WA: {data.supplierPhone}</Text>}
        </View>
      </View>
      <View style={s.box}>
        <View style={s.boxHead}><Text style={s.boxHeadText}>{k === 'po' ? 'Dikirim Ke' : 'Diterima Di'}</Text></View>
        <View style={s.boxBody}>
          <Text style={s.strong}>{store.name}</Text>
          {store.address && <Text style={s.line}>{store.address}</Text>}
          {store.phone && <Text style={s.dim}>Telp/WA: {store.phone}</Text>}
        </View>
      </View>
      <View style={s.boxWide}>
        <View style={s.boxHead}><Text style={s.boxHeadText}>Detail Dokumen</Text></View>
        <View style={s.boxBody}>
          <Field k={k === 'po' ? 'Tanggal PO' : 'Tanggal Terima'} v={data.date} />
          {k === 'po' && <Field k="Estimasi Tiba" v={data.expectedDate} />}
          {k !== 'po' && <Field k="Ref. PO" v={data.refPoNumber} />}
          {k === 'gr' && <Field k="No. DO" v={data.refDoNumber} />}
          {k === 'do' && <Field k="Ref. GR" v={data.refGrNumber} />}
          {k === 'gr' && <Field k="Pembayaran" v={data.paymentLabel} />}
          <Field k="Dibuat oleh" v={data.createdBy} />
        </View>
      </View>
    </View>
  );
}

type Col = { head: string; w: string; align?: 'right' | 'center'; cell: (it: PoItem | GrItem, i: number) => string };

function columnsFor(kind: PurchaseDocKind): Col[] {
  const nameOf = (it: PoItem | GrItem) => it.materialName;
  if (kind === 'po') return [
    { head: 'No', w: '6%', align: 'center', cell: (_, i) => String(i + 1) },
    { head: 'Nama Bahan Baku', w: '38%', cell: nameOf },
    { head: 'Satuan', w: '10%', align: 'center', cell: it => it.unit },
    { head: 'Qty', w: '12%', align: 'right', cell: it => qty(it.qty) },
    { head: 'Harga Satuan', w: '17%', align: 'right', cell: it => rp(it.price) },
    { head: 'Jumlah', w: '17%', align: 'right', cell: it => rp(it.subtotal) },
  ];
  if (kind === 'gr') return [
    { head: 'No', w: '5%', align: 'center', cell: (_, i) => String(i + 1) },
    { head: 'Nama Bahan Baku', w: '27%', cell: nameOf },
    { head: 'Sat.', w: '8%', align: 'center', cell: it => it.unit },
    { head: 'Dipesan', w: '11%', align: 'right', cell: it => ('orderedQty' in it ? qty(it.orderedQty) : qty(it.qty)) },
    { head: 'Diterima', w: '11%', align: 'right', cell: it => qty(it.qty) },
    { head: 'Sisa PO', w: '9%', align: 'right', cell: it => ('orderedQty' in it ? qty(Math.max(0, it.orderedQty - it.qty)) : '0') },
    { head: 'Harga Satuan', w: '14%', align: 'right', cell: it => rp(it.price) },
    { head: 'Jumlah', w: '15%', align: 'right', cell: it => rp(it.subtotal) },
  ];
  return [
    { head: 'No', w: '6%', align: 'center', cell: (_, i) => String(i + 1) },
    { head: 'Nama Bahan Baku', w: '34%', cell: nameOf },
    { head: 'Satuan', w: '10%', align: 'center', cell: it => it.unit },
    { head: 'Qty Diterima', w: '14%', align: 'right', cell: it => qty(it.qty) },
    { head: 'Kondisi', w: '14%', align: 'center', cell: () => '' },
    { head: 'Keterangan', w: '22%', cell: () => '' },
  ];
}

function ItemsTable({ data }: { data: PurchaseDocData }) {
  const cols = columnsFor(data.kind);
  return (
    <View style={s.table}>
      <View style={s.th}>
        {cols.map((c, i) => (
          <Text key={c.head} style={[s.thCell, { width: c.w }, c.align === 'right' ? s.right : c.align === 'center' ? s.center : {}, ...(i > 0 ? [{ borderLeftWidth: 1, borderLeftColor: '#E9A56F' }] : [])]}>{c.head}</Text>
        ))}
      </View>
      {data.items.map((it, ri) => (
        <View key={ri} style={[s.tr, ...(ri % 2 === 1 ? [s.trAlt] : [])]} wrap={false}>
          {cols.map((c, ci) => (
            <Text key={c.head} style={[s.td, { width: c.w }, c.align === 'right' ? s.right : c.align === 'center' ? s.center : {}, ...(ci > 0 ? [s.tdBorder] : [])]}>{c.cell(it, ri)}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Totals({ data }: { data: PurchaseDocData }) {
  const totalQty = data.items.reduce((a, it) => a + it.qty, 0);
  return (
    <View style={s.summary} wrap={false}>
      <View style={s.words}>
        <Text style={s.wordsLabel}>Terbilang</Text>
        <Text style={s.wordsText}>{terbilangRupiah(data.total)}</Text>
      </View>
      <View style={s.totals}>
        <View style={s.totRow}><Text style={s.totKey}>Jumlah Item</Text><Text style={s.totVal}>{data.items.length} jenis / {qty(totalQty)} unit</Text></View>
        <View style={s.totRow}><Text style={s.totKey}>Subtotal</Text><Text style={s.totVal}>{rp(data.total)}</Text></View>
        <View style={s.grand}><Text style={s.grandKey}>{data.kind === 'po' ? 'TOTAL PO' : 'TOTAL DITERIMA'}</Text><Text style={s.grandVal}>{rp(data.total)}</Text></View>
      </View>
    </View>
  );
}

function Signatures({ data, store }: { data: PurchaseDocData; store: StoreHeader }) {
  const k = data.kind;
  const sigs: { role: string; name?: string; meta?: string }[] = k === 'po'
    ? [{ role: 'Dibuat oleh', name: data.createdBy }, { role: 'Disetujui', name: store.ownerName }, { role: 'Supplier', name: data.supplierName }]
    : [
      { role: 'Pengirim (Supplier)', name: data.supplierName },
      { role: 'Penerima', name: data.createdBy },
      { role: k === 'gr' ? 'Disetujui' : 'Mengetahui', name: data.approvedBy, meta: data.approvedAt ? `Tgl. ${data.approvedAt}` : undefined },
    ];
  return (
    <View style={s.sigRow} wrap={false}>
      {sigs.map(g => (
        <View key={g.role} style={s.sigBox}>
          <Text style={s.sigRole}>{g.role}</Text>
          <View style={s.sigSpace} />
          <View style={s.sigLine} />
          <Text style={s.sigName}>{g.name ? `( ${g.name} )` : '(                                  )'}</Text>
          {g.meta && <Text style={s.sigMeta}>{g.meta}</Text>}
        </View>
      ))}
    </View>
  );
}

export function PurchaseDocPage({ data, store }: { data: PurchaseDocData; store: StoreHeader }) {
  const k = data.kind;
  const stamp = data.statusTone === 'void' ? 'DIBATALKAN' : data.statusLabel?.startsWith('DRAFT') || (k === 'po' && data.statusLabel === 'DRAFT') ? 'DRAFT' : '';
  return (
    <Page size="A4" style={s.page}>
      <View style={s.topBar} fixed />
      {stamp && <Text style={s.stamp} fixed>{stamp}</Text>}

      <Head data={data} store={store} />
      <Parties data={data} store={store} />
      <ItemsTable data={data} />
      {k !== 'do' && <Totals data={data} />}

      <View style={s.twoCol} wrap={false}>
        <View style={s.note}>
          <Text style={s.noteHead}>Catatan</Text>
          <Text style={s.noteText}>{data.note || '-'}</Text>
        </View>
        <View style={s.note}>
          <Text style={s.noteHead}>{k === 'po' ? 'Syarat & Ketentuan' : 'Ketentuan'}</Text>
          {TERMS[k].map((t, i) => <Text key={i} style={s.noteText}>{i + 1}. {t}</Text>)}
        </View>
      </View>

      {data.statusTone === 'void' && (
        <View style={s.voidBox} wrap={false}>
          <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.red, textTransform: 'uppercase' }}>Dokumen ini dibatalkan</Text>
          {data.cancelNote && <Text style={{ fontSize: 8.5, marginTop: 3 }}>Alasan: {data.cancelNote}</Text>}
        </View>
      )}

      <Signatures data={data} store={store} />

      <View style={s.footer} fixed>
        <Text style={s.footText}>{data.number} · {store.name} · {SITE_URL}</Text>
        <Text style={s.footText} render={({ pageNumber, totalPages, subPageNumber, subPageTotalPages }) => `${data.printedAt ? `Dicetak ${data.printedAt} · ` : ''}Halaman ${subPageNumber ?? pageNumber} / ${subPageTotalPages ?? totalPages}`} />
      </View>
    </Page>
  );
}

// Beberapa dokumen dalam satu PDF (cetak dari daftar yang dicentang): satu dokumen per halaman,
// nomor halaman dihitung per dokumen (subPage), bukan berlanjut antar dokumen.
export function PurchaseDocBundle({ docs, store, title }: { docs: PurchaseDocData[]; store: StoreHeader; title: string }) {
  return (
    <Document title={title} author={store.name}>
      {docs.map((d, i) => <PurchaseDocPage key={i} data={d} store={store} />)}
    </Document>
  );
}

export default function PurchaseDocPDF({ data, store }: { data: PurchaseDocData; store: StoreHeader }) {
  return (
    <Document title={`${TITLE[data.kind].main} ${data.number}`} author={store.name}>
      <PurchaseDocPage data={data} store={store} />
    </Document>
  );
}
