import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';

// "Efektif Sejak" di UI adalah date-picker (hari, bukan jam) — semua perbandingan effectiveFrom
// di file ini HARUS di tingkat hari WIB, bukan milidetik. Kalau tidak, entri lama yang sempat
// tersimpan dengan Timestamp.now() (jam berapa pun saat disimpan, bukan tengah malam) bisa
// "mengalahkan" entri baru yang di-set utk hari yang sama tapi tersimpan sebagai tengah malam —
// simpanan baru jadi kelihatan tidak berlaku walau seharusnya menggantikan yang lama.
function dayFloorMillis(ts: Timestamp): number {
  return wibDayStart(wibDateKey(ts.toDate())).toMillis();
}

// Biaya platform yang RMedia Solutions (super-admin) tagih ke pemilik usaha, dihitung dari
// omzet 3 channel transaksi (Penjualan Online, POS/Kasir, Konsinyasi). Riwayat rate disimpan
// append-only (lihat AdminFeeRate) — bukan satu doc yang di-overwrite — supaya rate yang dipakai
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
  effectiveFrom: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
}

// Tanpa orderBy di query Firestore supaya tidak butuh composite index (channel == + orderBy
// field lain) — koleksi ini kecil (satu entri per kali rate diubah), jadi sort di memori aman.
// Tiebreak dengan createdAt saat effectiveFrom sama persis (backdate ke tanggal yang sama
// lebih dari sekali) — tanpa ini, Firestore.get() tanpa orderBy mengembalikan urutan yang tidak
// terjamin, jadi entri mana yang "menang" untuk tanggal itu jadi acak, bukan pasti yang terakhir
// disimpan.
export async function getRateHistory(db: Firestore, channel: AdminFeeChannel): Promise<AdminFeeRate[]> {
  const snap = await db.collection('adminFeeRates').where('channel', '==', channel).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as AdminFeeRate))
    .sort((a, b) => dayFloorMillis(a.effectiveFrom) - dayFloorMillis(b.effectiveFrom) || a.createdAt.toMillis() - b.createdAt.toMillis());
}

export async function getAllRateHistories(db: Firestore): Promise<Record<AdminFeeChannel, AdminFeeRate[]>> {
  const entries = await Promise.all(ADMIN_FEE_CHANNELS.map(async c => [c, await getRateHistory(db, c)] as const));
  return Object.fromEntries(entries) as Record<AdminFeeChannel, AdminFeeRate[]>;
}

// Rate yang berlaku di waktu `when` — entri terbaru dengan effectiveFrom <= when, dibandingkan
// per hari WIB (lihat dayFloorMillis). `history` harus sudah urut ascending (lihat getRateHistory).
export function rateAtTime(history: AdminFeeRate[], when: Timestamp): AdminFeeRate | null {
  const whenDay = dayFloorMillis(when);
  let current: AdminFeeRate | null = null;
  for (const rate of history) {
    if (dayFloorMillis(rate.effectiveFrom) <= whenDay) current = rate;
    else break;
  }
  return current;
}

// fixed = nominal flat per transaksi (order/rekap), bukan per periode.
export function computeFee(revenue: number, rate: AdminFeeRate | null): number {
  if (!rate) return 0;
  return rate.type === 'percent' ? revenue * rate.value / 100 : rate.value;
}

interface OrderDoc {
  total?: number; source?: string; status?: string; paymentStatus?: string; createdAt?: Timestamp;
  invoiceNo?: string; customerName?: string;
}
interface RecapDoc { totalRevenue?: number; paymentStatus?: string; createdAt?: Timestamp; locationName?: string }

// Mengikuti filter "counted" yang sama dengan FinanceReportTab (Laporan Keuangan) — pesanan
// online yang belum dikonfirmasi ('baru'), belum lunas, atau dibatalkan tidak dihitung sebagai
// omzet, jadi juga tidak dikenakan biaya admin.
const isCountedOrder = (o: OrderDoc) =>
  (o.source !== 'portal' || o.status !== 'baru') && o.paymentStatus !== 'belum_lunas' && o.status !== 'dibatalkan';
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

// Invoice yang sudah dibuat menyimpan `transactionIds` (order/rekap id yang termasuk di
// dalamnya) — dipakai di sini untuk menandai status tiap transaksi "sudah ditagihkan" atau
// belum. Berbasis ID persis, bukan rentang tanggal invoice, supaya transaksi yang baru
// tercatat belakangan (mis. diinput mundur) di periode yang sudah pernah diinvoice tetap
// benar ditandai "belum" — karena memang belum masuk invoice manapun.
async function getInvoicedTransactionMap(db: Firestore): Promise<Map<string, { invoiceId: string; invoiceNo: string }>> {
  const snap = await db.collection('adminFeeInvoices').get();
  const map = new Map<string, { invoiceId: string; invoiceNo: string }>();
  snap.docs.forEach(d => {
    const data = d.data();
    const invoiceNo = (data.invoiceNo as string) ?? d.id;
    ((data.transactionIds as string[] | undefined) ?? []).forEach(id => {
      if (!map.has(id)) map.set(id, { invoiceId: d.id, invoiceNo });
    });
  });
  return map;
}

// Dipakai oleh GET /api/admin-fee/report (pratinjau) dan POST /api/admin-fee/invoices
// (snapshot saat invoice dibuat) — satu implementasi supaya keduanya selalu konsisten.
export async function computeReport(db: Firestore, from: string, to: string): Promise<AdminFeeReport> {
  const [orderSnap, recapSnap, rateHistories, invoicedMap] = await Promise.all([
    db.collection('orders').where('createdAt', '>=', wibDayStart(from)).where('createdAt', '<=', wibDayEnd(to)).get(),
    db.collection('consignmentRecaps').where('createdAt', '>=', wibDayStart(from)).where('createdAt', '<=', wibDayEnd(to)).get(),
    getAllRateHistories(db),
    getInvoicedTransactionMap(db),
  ]);

  const orders = orderSnap.docs.map(d => ({ id: d.id, ...(d.data() as OrderDoc) })).filter(isCountedOrder);
  const recaps = recapSnap.docs.map(d => ({ id: d.id, ...(d.data() as RecapDoc) })).filter(isCountedRecap);
  const now = Timestamp.now();

  const breakdown: AdminFeeChannelBreakdown[] = ADMIN_FEE_CHANNELS.map(channel => {
    const history = rateHistories[channel];
    const currentRate = rateAtTime(history, now);
    let source: { id: string; revenue: number; createdAt?: Timestamp; label: string }[];
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
        createdAt: t.createdAt ? { seconds: t.createdAt.seconds } : null,
        revenue: t.revenue, feeAmount: computeFee(t.revenue, rate),
        invoiceId: invoiced?.invoiceId ?? null, invoiceNo: invoiced?.invoiceNo ?? null,
      };
    });

    const revenue = transactions.reduce((s, t) => s + t.revenue, 0);
    const feeAmount = transactions.reduce((s, t) => s + t.feeAmount, 0);

    return {
      channel, label: ADMIN_FEE_CHANNEL_LABELS[channel],
      revenue, transactionCount: transactions.length, feeAmount,
      currentRate: currentRate ? { type: currentRate.type, value: currentRate.value } : null,
      transactions,
    };
  });

  const totalRevenue = breakdown.reduce((s, b) => s + b.revenue, 0);
  const totalFee = breakdown.reduce((s, b) => s + b.feeAmount, 0);

  return { from, to, breakdown, totalRevenue, totalFee };
}

// Semua id transaksi (order/rekap) yang tercakup di suatu laporan — dipersist ke invoice saat
// dibuat, supaya laporan berikutnya bisa menandai transaksi ini "sudah ditagihkan".
export function collectTransactionIds(report: AdminFeeReport): string[] {
  return report.breakdown.flatMap(b => b.transactions.map(t => t.id));
}
