import postgres from 'postgres';
import { getSql, parseJsonb } from '@/lib/db';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';

// ISql: interface bersama Sql (koneksi pool) & TransactionSql (di dalam sql.begin(...)) — dipakai
// supaya fungsi di sini bisa menerima keduanya, mirror pola PgClient di wallet-balance.ts.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type PgClient = postgres.ISql<{}>;

// "Efektif Sejak" di UI adalah date-picker (hari, bukan jam) — semua perbandingan effectiveFrom
// di file ini HARUS di tingkat hari WIB, bukan milidetik. `effective_from` di Postgres selalu
// diisi sudah dinormalkan ke tengah malam WIB saat POST (lihat rates/route.ts), tapi `when` yang
// dibandingkan (waktu transaksi order/rekap) adalah momen presisi-detik biasa, jadi tetap perlu
// diratakan ke hari yang sama sebelum dibandingkan.
function dayFloorMillis(d: Date): number {
  return wibDayStart(wibDateKey(d)).toMillis();
}

// Biaya platform yang RMedia Solutions (super-admin) tagih ke pemilik usaha, dihitung dari
// omzet 3 channel transaksi (Penjualan Online, POS/Kasir, Konsinyasi). Riwayat rate disimpan
// append-only (lihat AdminFeeRate) — bukan satu baris yang di-overwrite — supaya rate yang dipakai
// menghitung fee di suatu periode selalu rate yang benar-benar berlaku saat itu, bukan rate
// terbaru. Ini mengikuti pola snapshot costPrice yang sudah dipakai di orders/route.ts dan
// consignment/recap/route.ts untuk alasan yang sama: histori tidak boleh berubah retroaktif.

export type AdminFeeChannel = 'online' | 'kasir' | 'consignment';
export type AdminFeeType = 'percent' | 'fixed';

export const ADMIN_FEE_CHANNELS: AdminFeeChannel[] = ['online', 'kasir', 'consignment'];

export const ADMIN_FEE_CHANNEL_LABELS: Record<AdminFeeChannel, string> = {
  online: 'Penjualan Online',
  kasir: 'POS / Kasir',
  consignment: 'Konsinyasi',
};

export interface AdminFeeRate {
  id: string;
  channel: AdminFeeChannel;
  type: AdminFeeType;
  value: number;
  effectiveFrom: Date;
  createdAt: Date;
  createdBy: string;
}

interface RateRow {
  id: string; channel: AdminFeeChannel; type: AdminFeeType; value: string;
  effective_from: Date; created_at: Date; created_by: string | null;
}
function rowToRate(r: RateRow): AdminFeeRate {
  return {
    id: r.id, channel: r.channel, type: r.type, value: Number(r.value),
    effectiveFrom: r.effective_from, createdAt: r.created_at, createdBy: r.created_by ?? '',
  };
}

export async function getRateHistory(channel: AdminFeeChannel, pgTx?: PgClient): Promise<AdminFeeRate[]> {
  const sql = pgTx ?? getSql();
  const rows = await sql<RateRow[]>`
    select * from admin_fee_rates where channel = ${channel} order by effective_from asc, created_at asc
  `;
  return rows.map(rowToRate);
}

export async function getAllRateHistories(pgTx?: PgClient): Promise<Record<AdminFeeChannel, AdminFeeRate[]>> {
  const sql = pgTx ?? getSql();
  const rows = await sql<RateRow[]>`select * from admin_fee_rates order by channel, effective_from asc, created_at asc`;
  const byChannel: Record<AdminFeeChannel, AdminFeeRate[]> = { online: [], kasir: [], consignment: [] };
  for (const r of rows) byChannel[r.channel].push(rowToRate(r));
  return byChannel;
}

// Rate yang berlaku di waktu `when` — entri terbaru dengan effectiveFrom <= when, dibandingkan
// per hari WIB (lihat dayFloorMillis). `history` harus sudah urut ascending (lihat getRateHistory).
export function rateAtTime(history: AdminFeeRate[], when: Date): AdminFeeRate | null {
  const whenDay = dayFloorMillis(when);
  let current: AdminFeeRate | null = null;
  for (const rate of history) {
    if (dayFloorMillis(rate.effectiveFrom) <= whenDay) current = rate;
    else break;
  }
  return current;
}

// fixed = nominal flat per transaksi (order/rekap), bukan per periode.
// Dibulatkan ke Rupiah utuh — tanpa ini, rate persen menghasilkan pecahan Rupiah (mis. 3086,425)
// yang ikut tersimpan apa adanya ke invoice.
export function computeFee(revenue: number, rate: AdminFeeRate | null): number {
  if (!rate) return 0;
  return rate.type === 'percent' ? Math.round(revenue * rate.value / 100) : rate.value;
}

interface OrderDoc {
  total?: number; source?: string; status?: string; paymentStatus?: string; createdAt?: Date;
  invoiceNo?: string; customerName?: string;
}
interface RecapDoc { totalRevenue?: number; paymentStatus?: string; createdAt?: Date; locationName?: string }

// Mengikuti filter "counted" yang sama dengan FinanceReportTab (Laporan Keuangan) — pesanan
// yang belum dikonfirmasi ('baru' — online atau kasir berisi item "Buka PO"), belum lunas, atau
// dibatalkan tidak dihitung sebagai omzet, jadi juga tidak dikenakan biaya admin.
const isCountedOrder = (o: OrderDoc) =>
  (o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan';
const isCountedRecap = (r: RecapDoc) => r.paymentStatus !== 'belum_lunas';

export interface AdminFeeTransaction {
  id: string; label: string;
  createdAt: { seconds: number } | null;
  revenue: number; feeAmount: number;
  invoiceId: string | null; invoiceNo: string | null;
}

export interface AdminFeeChannelBreakdown {
  channel: AdminFeeChannel; label: string;
  revenue: number; transactionCount: number; feeAmount: number;
  currentRate: { type: AdminFeeType; value: number } | null;
  transactions: AdminFeeTransaction[];
}

export interface AdminFeeReport {
  from: string; to: string;
  breakdown: AdminFeeChannelBreakdown[];
  totalRevenue: number; totalFee: number;
}

interface InvoiceIdsRow { id: string; invoice_no: string | null; transaction_ids: unknown }

// Invoice yang sudah dibuat menyimpan `transactionIds` (order/rekap id yang termasuk di
// dalamnya) — dipakai di sini untuk menandai status tiap transaksi "sudah ditagihkan" atau
// belum. Berbasis ID persis, bukan rentang tanggal invoice, supaya transaksi yang baru
// tercatat belakangan (mis. diinput mundur) di periode yang sudah pernah diinvoice tetap
// benar ditandai "belum" — karena memang belum masuk invoice manapun.
async function getInvoicedTransactionMap(pgTx?: PgClient): Promise<Map<string, { invoiceId: string; invoiceNo: string }>> {
  const sql = pgTx ?? getSql();
  // Invoice yang dibatalkan tidak menahan transaksinya — harus bisa masuk invoice baru lagi,
  // itulah gunanya membatalkan.
  const rows = await sql<InvoiceIdsRow[]>`
    select id, invoice_no, transaction_ids from admin_fee_invoices where status != 'cancelled'
  `;
  const map = new Map<string, { invoiceId: string; invoiceNo: string }>();
  rows.forEach(r => {
    const invoiceNo = r.invoice_no ?? r.id;
    const ids = (parseJsonb(r.transaction_ids as string | string[] | null) as string[] | null) ?? [];
    ids.forEach(id => { if (!map.has(id)) map.set(id, { invoiceId: r.id, invoiceNo }); });
  });
  return map;
}

// Dipakai oleh GET /api/admin-fee/report (pratinjau) dan POST /api/admin-fee/invoices
// (snapshot saat invoice dibuat) — satu implementasi supaya keduanya selalu konsisten.
//
// `pgTx`: POST /api/admin-fee/invoices membungkus computeReport INI dan penulisan invoice-nya
// dalam satu transaksi Postgres (lewat `sql.begin(...)`, dengan pg_advisory_xact_lock untuk
// menyerialkan pembuatan invoice) — tanpa itu, "belum ditagih" dihitung dari
// getInvoicedTransactionMap yang dibaca terpisah dari penulisan invoice, jadi dua invoice dengan
// periode tumpang-tindih yang dibuat hampir bersamaan bisa sama-sama melihat transaksi yang sama
// sebagai "belum ditagih" dan sama-sama menagihnya (TOCTOU).
export async function computeReport(from: string, to: string, pgTx?: PgClient): Promise<AdminFeeReport> {
  interface OrderRow { id: string; total: string; source: string; status: string; payment_status: string; created_at: Date; invoice_no: string | null; customer_name: string }
  interface RecapRow { id: string; total_revenue: string; payment_status: string; created_at: Date; location_name: string }
  const sql = pgTx ?? getSql();
  const [orderRows, recapRows, rateHistories, invoicedMap] = await Promise.all([
    sql<OrderRow[]>`select id, total, source, status, payment_status, created_at, invoice_no, customer_name from orders where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}`,
    sql<RecapRow[]>`select id, total_revenue, payment_status, created_at, location_name from consignment_recaps where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}`,
    getAllRateHistories(pgTx),
    getInvoicedTransactionMap(pgTx),
  ]);

  const orders = orderRows.map((r): OrderDoc & { id: string } => ({
    id: r.id, total: Number(r.total), source: r.source, status: r.status, paymentStatus: r.payment_status,
    createdAt: r.created_at, invoiceNo: r.invoice_no ?? undefined, customerName: r.customer_name,
  })).filter(isCountedOrder);
  const recaps = recapRows.map((r): RecapDoc & { id: string } => ({
    id: r.id, totalRevenue: Number(r.total_revenue), paymentStatus: r.payment_status,
    createdAt: r.created_at, locationName: r.location_name,
  })).filter(isCountedRecap);
  const now = new Date();

  const breakdown: AdminFeeChannelBreakdown[] = ADMIN_FEE_CHANNELS.map(channel => {
    const history = rateHistories[channel];
    const currentRate = rateAtTime(history, now);
    let source: { id: string; revenue: number; createdAt?: Date; label: string }[];
    if (channel === 'online') {
      source = orders.filter(o => o.source === 'portal')
        .map(o => ({ id: o.id, revenue: o.total ?? 0, createdAt: o.createdAt, label: o.invoiceNo ?? o.customerName ?? o.id }));
    } else if (channel === 'kasir') {
      source = orders.filter(o => o.source !== 'portal')
        .map(o => ({ id: o.id, revenue: o.total ?? 0, createdAt: o.createdAt, label: o.invoiceNo ?? o.customerName ?? o.id }));
    } else {
      source = recaps.map(r => ({ id: r.id, revenue: r.totalRevenue ?? 0, createdAt: r.createdAt, label: r.locationName ?? r.id }));
    }

    const transactions: AdminFeeTransaction[] = source.map(t => {
      const rate = t.createdAt ? rateAtTime(history, t.createdAt) : null;
      const invoiced = invoicedMap.get(t.id) ?? null;
      return {
        id: t.id, label: t.label,
        createdAt: t.createdAt ? { seconds: Math.floor(t.createdAt.getTime() / 1000) } : null,
        revenue: t.revenue, feeAmount: computeFee(t.revenue, rate),
        invoiceId: invoiced?.invoiceId ?? null, invoiceNo: invoiced?.invoiceNo ?? null,
      };
    });

    // `transactions` keeps every transaksi in range (termasuk yang sudah masuk invoice lain)
    // supaya modal detail tetap menunjukkan status "Sudah Ditagihkan" apa adanya — tapi total
    // omzet/biaya yang dipakai untuk invoice BARU cuma dihitung dari yang belum diklaim invoice
    // manapun (`billable`). Tanpa filter ini, dua laporan dengan rentang tanggal yang tumpang
    // tindih akan menagih ulang transaksi yang sama.
    const billable = transactions.filter(t => !t.invoiceId);
    const revenue = billable.reduce((s, t) => s + t.revenue, 0);
    const feeAmount = billable.reduce((s, t) => s + t.feeAmount, 0);

    return {
      channel, label: ADMIN_FEE_CHANNEL_LABELS[channel],
      revenue, transactionCount: billable.length, feeAmount,
      currentRate: currentRate ? { type: currentRate.type, value: currentRate.value } : null,
      transactions,
    };
  });

  const totalRevenue = breakdown.reduce((s, b) => s + b.revenue, 0);
  const totalFee = breakdown.reduce((s, b) => s + b.feeAmount, 0);

  return { from, to, breakdown, totalRevenue, totalFee };
}

// Semua id transaksi (order/rekap) yang tercakup di suatu laporan — dipersist ke invoice saat
// dibuat, supaya laporan berikutnya bisa menandai transaksi ini "sudah ditagihkan". Filter
// `!t.invoiceId` supaya transaksi yang sudah masuk invoice lain (apapun statusnya — draft,
// terkirim, atau lunas) tidak ikut ke-double-claim ke invoice baru ini.
export function collectTransactionIds(report: AdminFeeReport): string[] {
  return report.breakdown.flatMap(b => b.transactions.filter(t => !t.invoiceId).map(t => t.id));
}

export interface AdminFeeInvoiceRow {
  id: string; invoice_no: string | null; period_from: string | null; period_to: string | null;
  breakdown: unknown; transaction_ids: unknown;
  total_revenue: string | null; total_fee: string | null;
  status: string; note: string | null; due_date: string | null;
  created_at: Date; created_by: string | null; updated_at: Date | null;
  paid_at: Date | null; paid_by: string | null; payment_note: string | null;
  cancelled_at: Date | null; cancelled_by: string | null;
}

function toTs(d: Date | null): { seconds: number; nanoseconds: number } | null {
  return d ? { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 } : null;
}

// Bentuk JSON yang dikirim ke frontend (AdminFeeTab/AdminFeeBillingTab) — camelCase, timestamp
// sebagai `{seconds,nanoseconds}` mengikuti konvensi Firestore Timestamp lama yang masih dipakai
// UI di seluruh app (lihat toTimestamp di wallet-transfers/route.ts untuk pola yang sama).
export function serializeInvoiceRow(r: AdminFeeInvoiceRow) {
  return {
    id: r.id, invoiceNo: r.invoice_no, periodFrom: r.period_from, periodTo: r.period_to,
    breakdown: parseJsonb(r.breakdown as string | unknown[] | null),
    transactionIds: parseJsonb(r.transaction_ids as string | string[] | null),
    totalRevenue: r.total_revenue != null ? Number(r.total_revenue) : 0,
    totalFee: r.total_fee != null ? Number(r.total_fee) : 0,
    status: r.status, note: r.note, dueDate: r.due_date,
    createdAt: toTs(r.created_at), createdBy: r.created_by,
    paidAt: toTs(r.paid_at), paidBy: r.paid_by, paymentNote: r.payment_note,
    cancelledAt: toTs(r.cancelled_at), cancelledBy: r.cancelled_by,
    updatedAt: toTs(r.updated_at),
  };
}
