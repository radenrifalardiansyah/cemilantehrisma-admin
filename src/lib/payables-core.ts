import { dueInfo, isValidDueDate } from '@/lib/receivable';
import { parseMoneyAmount } from '@/lib/money-input';

// Bagian MURNI (tanpa DB/server) logika Hutang Supplier — aman dipakai di klien dan diuji langsung.
// Akses DB-nya ada di src/lib/payables-pg.ts dan src/lib/purchase-payments.ts.
//
// Model: pembelian bahan baku belum lunas dicicil lewat tabel `material_purchase_payments`. Status
// DITURUNKAN dari total vs jumlah pembayaran aktif; kolom material_purchases.payment_status tetap
// 'belum_lunas' | 'lunas' (jadi semua pembaca lama tidak ikut berubah) dan baru jadi 'lunas' saat sisa <= toleransi.

export const PAY_TOLERANCE = 1;      // sisa sampai Rp 1 dianggap lunas
export const ALERT_DAYS = 3;         // peringatan mulai H-3 sebelum jatuh tempo
const EPS = 0.005;                   // pembulatan numeric 2 desimal

export type PaymentState = 'belum_lunas' | 'sebagian' | 'lunas';
export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = { belum_lunas: 'Belum Lunas', sebagian: 'Sebagian', lunas: 'Lunas' };

export class PaymentError extends Error {}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const formatRupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

export const remainingOf = (total: number, paid: number) => Math.max(0, r2(total - paid));

// Status dari angka murni: lunas bila dibayar >= total - toleransi; 0 dibayar = belum lunas; selain itu sebagian.
export function derivePaymentState(total: number, paid: number): PaymentState {
  if (paid >= total - PAY_TOLERANCE - EPS) return 'lunas';
  if (paid <= 0) return 'belum_lunas';
  return 'sebagian';
}

// Status sebuah pembelian: kolom 'lunas' (termasuk pembelian lunas lama yang tak punya baris pembayaran) = lunas;
// selain itu diturunkan dari pembayaran. Pembelian yang dibatalkan (void) tidak punya status → null.
export function purchasePaymentState(p: { paymentStatus: string; total: number; paid: number; voided: boolean }): PaymentState | null {
  if (p.voided) return null;
  if (p.paymentStatus === 'lunas') return 'lunas';
  return derivePaymentState(p.total, p.paid);
}

// Validasi nominal satu pembayaran terhadap sisa (nominal tak boleh melebihi sisa). Mengembalikan angka bersih atau melempar PaymentError.
export function validatePaymentAmount(raw: unknown, remaining: number): number {
  const amount = parseMoneyAmount(raw);
  if (amount === null || amount <= 0) throw new PaymentError('Nominal pembayaran harus lebih dari 0.');
  if (amount > remaining + EPS) throw new PaymentError(`Nominal melebihi sisa hutang (${formatRupiah(remaining)}).`);
  return amount;
}

// Pembayaran ini melunasi? (sisa setelah bayar <= toleransi)
export const settlesPurchase = (remaining: number, amount: number) => remaining - amount <= PAY_TOLERANCE + EPS;

// ── Jatuh tempo ────────────────────────────────────────────────────────────────────────────
export type DueStatus = 'none' | 'overdue' | 'today' | 'soon' | 'later';

export const DUE_STATUS_LABEL: Record<DueStatus, string> = {
  none: 'Tanpa jatuh tempo', overdue: 'Lewat jatuh tempo', today: 'Jatuh tempo hari ini', soon: 'Segera jatuh tempo', later: 'Belum jatuh tempo',
};

/** Parse `dueDate` dari body: undefined = tidak diubah; null/'' = hapus; string valid yyyy-mm-dd = set. */
export function parseDueDate(raw: unknown): { value: string | null } | { error: string } | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return { value: null };
  if (!isValidDueDate(raw)) return { error: 'Tanggal jatuh tempo tidak valid (format YYYY-MM-DD).' };
  return { value: raw };
}

export function payableDueStatus(due: string | null | undefined, now = new Date()): { status: DueStatus; days: number } {
  const info = dueInfo(due, now);
  if (!info) return { status: 'none', days: 0 };
  if (info.state === 'overdue') return { status: 'overdue', days: info.days };
  if (info.state === 'today') return { status: 'today', days: 0 };
  return { status: info.days <= ALERT_DAYS ? 'soon' : 'later', days: info.days };
}

/** Masuk peringatan: lewat jatuh tempo, jatuh tempo hari ini, atau <= H-3. */
export const isAlertStatus = (s: DueStatus) => s === 'overdue' || s === 'today' || s === 'soon';

// ── Rekap per supplier ─────────────────────────────────────────────────────────────────────
export interface PayableRawRow {
  id: string; supplierId: string | null; supplierName: string; poNumber: string | null; grNumber: string | null;
  date: string; total: number; paid: number; dueDate: string | null; walletId: string | null;
}
export interface PayableRow extends PayableRawRow {
  remaining: number; state: PaymentState; dueStatus: DueStatus; dueDays: number;
}
export interface SupplierPayable {
  key: string; supplierId: string | null; supplierName: string;
  totalDebt: number; count: number; nearestDue: string | null;
  overdueCount: number; overdueAmount: number; items: PayableRow[];
}
export interface PayablesSummary {
  totalDebt: number; supplierCount: number; count: number;
  overdueCount: number; overdueAmount: number;
  /** Peringatan = lewat jatuh tempo + jatuh tempo hari ini + <= H-3. */
  alertCount: number; alertAmount: number; alertSupplierCount: number;
}

/** Hanya hutang yang masih ada (sisa di atas toleransi); null bila sudah lunas. */
export function buildPayableRow(raw: PayableRawRow, now = new Date()): PayableRow | null {
  const remaining = remainingOf(raw.total, raw.paid);
  if (remaining <= PAY_TOLERANCE + EPS) return null;
  const due = payableDueStatus(raw.dueDate, now);
  return { ...raw, remaining, state: derivePaymentState(raw.total, raw.paid), dueStatus: due.status, dueDays: due.days };
}

const supplierKey = (r: Pick<PayableRow, 'supplierId' | 'supplierName'>) =>
  r.supplierId ? `id:${r.supplierId}` : `name:${r.supplierName.trim().toLowerCase()}`;

// Jatuh tempo kosong diurutkan paling akhir.
const byDueThenDate = (a: PayableRow, b: PayableRow) =>
  (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') || a.date.localeCompare(b.date);

export function groupPayablesBySupplier(rows: PayableRow[]): SupplierPayable[] {
  const map = new Map<string, SupplierPayable>();
  for (const r of rows) {
    const key = supplierKey(r);
    let g = map.get(key);
    if (!g) {
      g = { key, supplierId: r.supplierId, supplierName: r.supplierName.trim() || 'Tanpa nama', totalDebt: 0, count: 0, nearestDue: null, overdueCount: 0, overdueAmount: 0, items: [] };
      map.set(key, g);
    }
    g.totalDebt = r2(g.totalDebt + r.remaining);
    g.count += 1;
    if (r.dueDate && (g.nearestDue === null || r.dueDate < g.nearestDue)) g.nearestDue = r.dueDate;
    if (r.dueStatus === 'overdue') { g.overdueCount += 1; g.overdueAmount = r2(g.overdueAmount + r.remaining); }
    g.items.push(r);
  }
  const groups = [...map.values()];
  groups.forEach(g => g.items.sort(byDueThenDate));
  // Terdesak dulu: jatuh tempo terdekat (kosong paling akhir), lalu hutang terbesar.
  return groups.sort((a, b) =>
    (a.nearestDue ?? '9999-99-99').localeCompare(b.nearestDue ?? '9999-99-99') || b.totalDebt - a.totalDebt || a.supplierName.localeCompare(b.supplierName));
}

export function summarizePayables(rows: PayableRow[]): PayablesSummary {
  const suppliers = new Set<string>();
  const alertSuppliers = new Set<string>();
  const s: PayablesSummary = { totalDebt: 0, supplierCount: 0, count: rows.length, overdueCount: 0, overdueAmount: 0, alertCount: 0, alertAmount: 0, alertSupplierCount: 0 };
  for (const r of rows) {
    const key = supplierKey(r);
    suppliers.add(key);
    s.totalDebt = r2(s.totalDebt + r.remaining);
    if (r.dueStatus === 'overdue') { s.overdueCount += 1; s.overdueAmount = r2(s.overdueAmount + r.remaining); }
    if (isAlertStatus(r.dueStatus)) { s.alertCount += 1; s.alertAmount = r2(s.alertAmount + r.remaining); alertSuppliers.add(key); }
  }
  s.supplierCount = suppliers.size;
  s.alertSupplierCount = alertSuppliers.size;
  return s;
}

/** Kalimat peringatan (banner & notifikasi): null bila tak ada yang perlu diperingatkan. */
export function alertMessage(s: PayablesSummary): string | null {
  if (s.alertCount === 0) return null;
  const overdue = s.overdueCount > 0 ? `${s.overdueCount} pembelian lewat jatuh tempo` : '';
  const soon = s.alertCount - s.overdueCount;
  const near = soon > 0 ? `${soon} jatuh tempo dalam ${ALERT_DAYS} hari` : '';
  return `${[overdue, near].filter(Boolean).join(', ')} — total sisa ${formatRupiah(s.alertAmount)} ke ${s.alertSupplierCount} supplier.`;
}
