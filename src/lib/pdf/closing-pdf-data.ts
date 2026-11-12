import { formatDate, formatRp } from '@/lib/format';
import { sumLines, type ClosingLine, type LineTotals } from '@/lib/closing';

// Pemetaan data (murni, tanpa DB) untuk PDF Closing HPP: baris closing/pool → struktur yang dirender
// ClosingReportPDF. Dipisah dari komponen supaya bisa diuji tanpa merender PDF.

// Batas baris per bagian di PDF (total tetap dihitung dari SEMUA baris; yang dipotong hanya rinciannya).
export const PDF_MAX_LINES = 3000;

export interface ClosingRecord {
  id: string; period_from: string | null; period_to: string; closed_at: Date; closed_by: string | null;
  total_qty: string | null; total_cogs: string | null; total_revenue: string | null; item_count: number; note: string | null;
  status: string; reopened_at: Date | null; reopened_by: string | null; reopen_reason: string | null; is_opening_balance: boolean;
}

export interface PdfLine {
  no: number; invoice: string; party: string; note: string;
  txDate: string; paidDate: string | null; qty: number; cogs: number; revenue: number;
}

export interface PdfSection {
  title: string;
  hint?: string;
  lines: PdfLine[];
  omitted: number;        // baris yang tidak dicetak karena melebihi PDF_MAX_LINES
  totals: LineTotals;     // angka resmi untuk baris total tabel
  emptyText: string;
  breakBefore?: boolean;  // mulai di halaman baru (bagian piutang pada draf)
  showWords?: boolean;    // tampilkan terbilang HPP & omzet (nominal yang di-closing) di bawah tabel
}

export interface ClosingPdfData {
  variant: 'closing' | 'opening' | 'draft';
  title: string;
  subtitle: string;
  periodText: string;
  generatedAt: string;
  meta: { label: string; value: string }[];
  summary: { label: string; value: string }[];
  notice?: string;
  notes: string[];        // catatan kaki (mis. selisih pembulatan)
  sections: PdfSection[];
  fileName: string;
}

export const dayLabel = (d: string | null | undefined): string => (d ? formatDate(`${d}T00:00:00Z`, 'short', 'UTC') : '–');
export const stampLabel = (d: Date): string => `${formatDate(d, 'longDateTime', 'Asia/Jakarta')} WIB`;
const qtyLabel = (n: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
const num = (v: string | null): number | null => (v == null ? null : Number(v));

const orderedLines = (lines: ClosingLine[]): ClosingLine[] =>
  [...lines].sort((a, b) =>
    (a.paidDate ?? a.txDate).localeCompare(b.paidDate ?? b.txDate) || a.txDate.localeCompare(b.txDate) || a.invoiceNo.localeCompare(b.invoiceNo));

function toPdfLines(lines: ClosingLine[]): { lines: PdfLine[]; omitted: number } {
  const shown = orderedLines(lines).slice(0, PDF_MAX_LINES);
  return {
    lines: shown.map((l, i) => ({
      no: i + 1, invoice: l.invoiceNo, party: l.party, note: l.note ?? '', txDate: l.txDate, paidDate: l.paidDate,
      qty: l.qty, cogs: l.cogs, revenue: l.revenue,
    })),
    omitted: Math.max(0, lines.length - shown.length),
  };
}

const summaryOf = (t: LineTotals) => [
  { label: 'Jumlah Transaksi', value: String(t.count) },
  { label: 'Total Qty', value: `${qtyLabel(t.qty)} unit` },
  { label: 'Total HPP', value: formatRp(t.cogs) },
  { label: 'Total Omzet', value: formatRp(t.revenue) },
];

// PDF sebuah closing yang sudah ada. `lines` = hasil loadClosingLines (boleh kosong).
export function closingToPdfData(c: ClosingRecord, lines: ClosingLine[], generatedAt: Date = new Date()): ClosingPdfData {
  const periodText = c.is_opening_balance
    ? `Saldo awal sampai ${dayLabel(c.period_to)}`
    : (c.period_from && c.period_from !== c.period_to ? `${dayLabel(c.period_from)} – ${dayLabel(c.period_to)}` : dayLabel(c.period_to));
  const reopened = c.status !== 'aktif';
  const meta = [
    { label: 'Periode', value: periodText },
    { label: 'Waktu Closing', value: stampLabel(c.closed_at) },
    { label: 'Ditutup Oleh', value: c.closed_by || '–' },
    { label: 'Status', value: reopened ? 'Dibuka ulang' : 'Aktif' },
  ];
  if (reopened) {
    meta.push({ label: 'Dibuka Ulang', value: `${c.reopened_by ? `${c.reopened_by} · ` : ''}${c.reopened_at ? stampLabel(c.reopened_at) : '–'}` });
    meta.push({ label: 'Alasan Buka Ulang', value: c.reopen_reason || '–' });
  }
  if (c.note) meta.push({ label: 'Catatan', value: c.note });

  const base = {
    title: 'LAPORAN CLOSING HPP', subtitle: 'Dokumen Internal', periodText, generatedAt: stampLabel(generatedAt), meta,
    fileName: `closing-hpp-${c.period_to}${c.is_opening_balance ? '-saldo-awal' : ''}-${c.id.slice(0, 8)}.pdf`,
  };

  // Saldo awal: tidak punya total/rincian nominal — jangan mengarang angka.
  if (c.is_opening_balance) {
    return {
      ...base, variant: 'opening', notes: [], sections: [],
      summary: [{ label: 'Jumlah Item', value: String(c.item_count) }],
      notice: `Closing saldo awal: seluruh transaksi yang sudah dibayar sampai ${dayLabel(c.period_to)} ditandai tertutup (${c.item_count} item) tanpa dihitung nominalnya. Closing ini tidak memiliki total HPP/omzet maupun rincian transaksi.`,
    };
  }

  const computed = sumLines(lines);
  const snap: LineTotals = {
    count: c.item_count,
    qty: num(c.total_qty) ?? computed.qty,
    cogs: num(c.total_cogs) ?? computed.cogs,
    revenue: num(c.total_revenue) ?? computed.revenue,
  };
  const notes: string[] = [];
  let notice: string | undefined;
  if (lines.length === 0) {
    notice = reopened
      ? 'Closing ini sudah dibuka ulang: transaksinya kembali berstatus "belum closing", sehingga rincian per transaksi tidak tersedia. Angka di atas adalah total yang tersimpan saat closing ditutup.'
      : 'Rincian transaksi tidak ditemukan untuk closing ini. Angka di atas adalah total yang tersimpan saat closing ditutup.';
  } else {
    const diff = computed.count !== snap.count || computed.qty !== snap.qty || computed.cogs !== snap.cogs || computed.revenue !== snap.revenue;
    if (diff) {
      notes.push(`Jumlah baris rincian di atas (${computed.count} transaksi, qty ${qtyLabel(computed.qty)}, HPP ${formatRp(computed.cogs)}, omzet ${formatRp(computed.revenue)}) dihitung ulang dari data saat ini dan berbeda dari total tersimpan. Angka resmi closing adalah total tersimpan (snapshot) yang tertera pada ringkasan dan baris total.`);
    }
  }
  const pl = toPdfLines(lines);
  const sections: PdfSection[] = lines.length === 0 ? [] : [{
    title: 'Rincian Transaksi', lines: pl.lines, omitted: pl.omitted, totals: snap, emptyText: 'Tidak ada rincian.', showWords: true,
  }];
  return { ...base, variant: 'closing', summary: summaryOf(snap), notice, notes, sections };
}

export interface DraftInput {
  upTo: string | null;           // null = semua yang sudah dibayar & belum closing
  today: string;
  lastClosingTo: string | null;
  paid: ClosingLine[];           // sudah difilter sesuai upTo oleh pemanggil
  receivable: ClosingLine[];
  generatedAt?: Date;
}

// Draf (pratinjau) closing — belum disimpan ke mana pun, bukan closing resmi.
export function draftToPdfData(i: DraftInput): ClosingPdfData {
  const paidT = sumLines(i.paid);
  const recvT = sumLines(i.receivable);
  const paid = toPdfLines(i.paid);
  const recv = toPdfLines(i.receivable);
  const scope = i.upTo ? `Sampai tanggal bayar ${dayLabel(i.upTo)}` : `Per ${dayLabel(i.today)} (semua yang belum closing)`;
  return {
    variant: 'draft',
    title: 'DRAF CLOSING HPP',
    subtitle: 'Draf · bukan closing resmi',
    periodText: scope,
    generatedAt: stampLabel(i.generatedAt ?? new Date()),
    meta: [
      { label: 'Cakupan', value: scope },
      { label: 'Closing Terakhir', value: i.lastClosingTo ? `Sampai ${dayLabel(i.lastClosingTo)}` : 'Belum ada closing aktif' },
    ],
    summary: [
      { label: 'Sudah Dibayar · Transaksi', value: String(paidT.count) },
      { label: 'Sudah Dibayar · HPP', value: formatRp(paidT.cogs) },
      { label: 'Sudah Dibayar · Omzet', value: formatRp(paidT.revenue) },
      { label: 'Piutang · Transaksi', value: String(recvT.count) },
      { label: 'Piutang · HPP', value: formatRp(recvT.cogs) },
      { label: 'Piutang · Omzet', value: formatRp(recvT.revenue) },
    ],
    notice: 'DRAF — dokumen ini hanya pratinjau kondisi saat dicetak dan BUKAN closing resmi. Tidak ada data yang ditutup atau disimpan. Piutang tidak ikut closing sampai dibayar.',
    notes: [],
    sections: [
      { title: 'A. Sudah dibayar, belum closing', hint: i.upTo ? `Tanggal bayar sampai ${dayLabel(i.upTo)} — bagian yang akan ikut closing.` : 'Akan ikut closing berikutnya.', lines: paid.lines, omitted: paid.omitted, totals: paidT, emptyText: 'Tidak ada transaksi.', showWords: true },
      { title: 'B. Piutang (belum dibayar)', hint: 'Tidak ikut closing sampai dibayar. Untuk pesanan yang dicicil hanya porsi sisa.', lines: recv.lines, omitted: recv.omitted, totals: recvT, emptyText: 'Tidak ada piutang.', breakBefore: true },
    ],
    fileName: `draf-closing-hpp-${i.upTo ?? i.today}.pdf`,
  };
}
