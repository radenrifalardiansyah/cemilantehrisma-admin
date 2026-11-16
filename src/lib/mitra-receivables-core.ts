import { PAY_TOLERANCE, derivePaymentState, isAlertStatus, payableDueStatus, remainingOf, type DueStatus, type PaymentState } from '@/lib/payables-core';

// Bagian MURNI (tanpa DB/server) laporan Piutang Mitra: piutang aktif per mitra (sisa rekap belum lunas), umur piutang,
// jatuh tempo, serta riwayat pembayaran lintas rekap. Aman dipakai di klien dan diuji langsung.
// Akses DB-nya ada di rute src/app/api/consignment/receivables/**.

export { isAlertStatus };
export type { DueStatus, PaymentState };

const EPS = 0.005;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const todayWib = (now: Date) => new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
const dayNumber = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

export const PAYMENTS_LIMIT = 1000;

// ── Piutang aktif ──────────────────────────────────────────────────────────────────────────
export interface ReceivableRawRow {
  recapId: string; locationId: string; locationName: string;
  /** Tanggal rekap (hari kalender WIB, yyyy-mm-dd) — dasar umur piutang. */
  date: string;
  total: number; paid: number; dueDate: string | null; walletId: string | null;
}
export interface ReceivableItem extends ReceivableRawRow {
  remaining: number; state: Exclude<PaymentState, 'lunas'>; dueStatus: DueStatus; dueDays: number; ageDays: number;
}
export interface MitraReceivable {
  locationId: string; locationName: string; totalReceivable: number; recapCount: number; nearestDue: string | null;
  overdueCount: number; overdueAmount: number; oldestDays: number; items: ReceivableItem[];
}
export interface AgingBucket { count: number; amount: number }
export interface ReceivablesSummary {
  totalReceivable: number; mitraCount: number; recapCount: number;
  overdueCount: number; overdueAmount: number;
  /** Peringatan = lewat jatuh tempo + jatuh tempo hari ini + <= H-3. */
  alertCount: number; alertAmount: number;
  /** Umur dari tanggal rekap (bukan jatuh tempo). Tiap rekap masuk TEPAT satu kelompok umur, ada jatuh tempo atau tidak. */
  aging: { b0_7: AgingBucket; b8_30: AgingBucket; b31_plus: AgingBucket };
}

/** Hanya piutang yang masih ada (sisa di atas toleransi); null bila sudah lunas. Umur tak pernah negatif. */
export function buildReceivableItem(raw: ReceivableRawRow, now = new Date()): ReceivableItem | null {
  const remaining = remainingOf(raw.total, raw.paid);
  if (remaining <= PAY_TOLERANCE + EPS) return null;
  const due = payableDueStatus(raw.dueDate, now);
  const state = derivePaymentState(raw.total, raw.paid);
  return {
    ...raw, remaining, state: state === 'lunas' ? 'sebagian' : state,
    dueStatus: due.status, dueDays: due.days, ageDays: Math.max(0, dayNumber(todayWib(now)) - dayNumber(raw.date)),
  };
}

export function buildReceivableItems(raws: ReceivableRawRow[], now = new Date()): ReceivableItem[] {
  return raws.flatMap(r => { const it = buildReceivableItem(r, now); return it ? [it] : []; });
}

// Jatuh tempo kosong diurutkan paling akhir.
const byDueThenDate = (a: ReceivableItem, b: ReceivableItem) =>
  (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') || a.date.localeCompare(b.date) || a.recapId.localeCompare(b.recapId);

export function groupReceivablesByMitra(items: ReceivableItem[]): MitraReceivable[] {
  const map = new Map<string, MitraReceivable>();
  for (const r of items) {
    let g = map.get(r.locationId);
    if (!g) {
      g = { locationId: r.locationId, locationName: r.locationName.trim() || 'Tanpa nama', totalReceivable: 0, recapCount: 0, nearestDue: null, overdueCount: 0, overdueAmount: 0, oldestDays: 0, items: [] };
      map.set(r.locationId, g);
    }
    g.totalReceivable = r2(g.totalReceivable + r.remaining);
    g.recapCount += 1;
    if (r.dueDate && (g.nearestDue === null || r.dueDate < g.nearestDue)) g.nearestDue = r.dueDate;
    if (r.dueStatus === 'overdue') { g.overdueCount += 1; g.overdueAmount = r2(g.overdueAmount + r.remaining); }
    if (r.ageDays > g.oldestDays) g.oldestDays = r.ageDays;
    g.items.push(r);
  }
  const groups = [...map.values()];
  groups.forEach(g => g.items.sort(byDueThenDate));
  // Terdesak dulu: jatuh tempo terdekat (kosong paling akhir), lalu piutang terbesar.
  return groups.sort((a, b) =>
    (a.nearestDue ?? '9999-99-99').localeCompare(b.nearestDue ?? '9999-99-99') || b.totalReceivable - a.totalReceivable || a.locationName.localeCompare(b.locationName));
}

export function summarizeReceivables(items: ReceivableItem[]): ReceivablesSummary {
  const mitras = new Set<string>();
  const empty = (): AgingBucket => ({ count: 0, amount: 0 });
  const s: ReceivablesSummary = {
    totalReceivable: 0, mitraCount: 0, recapCount: items.length, overdueCount: 0, overdueAmount: 0, alertCount: 0, alertAmount: 0,
    aging: { b0_7: empty(), b8_30: empty(), b31_plus: empty() },
  };
  for (const r of items) {
    mitras.add(r.locationId);
    s.totalReceivable = r2(s.totalReceivable + r.remaining);
    if (r.dueStatus === 'overdue') { s.overdueCount += 1; s.overdueAmount = r2(s.overdueAmount + r.remaining); }
    if (isAlertStatus(r.dueStatus)) { s.alertCount += 1; s.alertAmount = r2(s.alertAmount + r.remaining); }
    const b = r.ageDays <= 7 ? s.aging.b0_7 : r.ageDays <= 30 ? s.aging.b8_30 : s.aging.b31_plus;
    b.count += 1; b.amount = r2(b.amount + r.remaining);
  }
  s.mitraCount = mitras.size;
  return s;
}

/** Kalimat peringatan (banner): null bila tak ada yang perlu diperingatkan. */
export function receivablesAlertMessage(s: ReceivablesSummary): string | null {
  if (s.alertCount === 0) return null;
  const overdue = s.overdueCount > 0 ? `${s.overdueCount} rekap lewat jatuh tempo` : '';
  const soon = s.alertCount - s.overdueCount;
  const near = soon > 0 ? `${soon} rekap jatuh tempo dalam 3 hari` : '';
  return `${[overdue, near].filter(Boolean).join(', ')} — total sisa Rp${Math.round(s.alertAmount).toLocaleString('id-ID')}.`;
}

// 'soon' = jatuh tempo hari ini atau dalam <= 3 hari (belum lewat).
export type ReceivableDueFilter = 'all' | 'overdue' | 'soon';
export function filterReceivables(items: ReceivableItem[], opts: { due?: ReceivableDueFilter; search?: string }): ReceivableItem[] {
  const q = (opts.search ?? '').trim().toLowerCase();
  const due = opts.due ?? 'all';
  return items.filter(r =>
    (due === 'all' || (due === 'overdue' ? r.dueStatus === 'overdue' : r.dueStatus === 'today' || r.dueStatus === 'soon'))
    && (!q || r.locationName.toLowerCase().includes(q)));
}

export const RECEIVABLE_EXCEL_HEADERS = ['No', 'Mitra', 'Tanggal Rekap', 'Total', 'Dibayar', 'Status', 'Jatuh Tempo', 'Umur (hari)', 'Sisa Piutang'] as const;
export type ExcelCell = string | number;
// Baris Excel piutang (rekap per baris, urut seperti tampilan: per mitra); baris terakhir = total.
export function buildReceivableExcelRows(items: ReceivableItem[], fmtDate: (d: string) => string = d => d): { body: ExcelCell[][]; total: ExcelCell[] } {
  const body = groupReceivablesByMitra(items).flatMap(g => g.items).map((r, i): ExcelCell[] => [
    i + 1, r.locationName.trim() || 'Tanpa nama', fmtDate(r.date), r.total, r.paid,
    r.state === 'sebagian' ? 'Sebagian' : 'Belum Lunas', r.dueDate ? fmtDate(r.dueDate) : '-', r.ageDays, r.remaining,
  ]);
  const s = summarizeReceivables(items);
  return { body, total: ['', `TOTAL (${s.recapCount} rekap, ${s.mitraCount} mitra)`, '', '', '', '', '', '', s.totalReceivable] };
}

// ── Riwayat pembayaran ─────────────────────────────────────────────────────────────────────
export interface MitraPaymentRow {
  id: string; recapId: string; locationId: string; locationName: string;
  /** Tanggal uang diterima (hari kalender WIB, yyyy-mm-dd). */
  date: string; amount: number;
  walletId: string | null; walletName: string | null; note: string; createdBy: string | null;
  /** Pembayaran ini dibatalkan (tidak dihitung ke total). */
  voided: boolean;
  recapDate: string; recapTotal: number; createdAt: string;
}
export interface MitraPaymentsSummary { count: number; totalPaid: number; mitraCount: number; voidedCount: number }

// Pembayaran void tidak masuk count/total/mitraCount; hanya dihitung di voidedCount.
export function summarizeMitraPayments(rows: MitraPaymentRow[]): MitraPaymentsSummary {
  const mitras = new Set<string>();
  const s: MitraPaymentsSummary = { count: 0, totalPaid: 0, mitraCount: 0, voidedCount: 0 };
  for (const r of rows) {
    if (r.voided) { s.voidedCount += 1; continue; }
    s.count += 1;
    s.totalPaid = r2(s.totalPaid + r.amount);
    mitras.add(r.locationId);
  }
  s.mitraCount = mitras.size;
  return s;
}

// Filter klien: mitra (locationId, '' = semua) dan kata kunci (mitra/catatan/dompet/pencatat).
export function filterMitraPayments(rows: MitraPaymentRow[], opts: { locationId?: string; search?: string }): MitraPaymentRow[] {
  const q = (opts.search ?? '').trim().toLowerCase();
  return rows.filter(r =>
    (!opts.locationId || r.locationId === opts.locationId)
    && (!q || [r.locationName, r.note, r.walletName, r.createdBy].some(t => (t ?? '').toLowerCase().includes(q))));
}

// Daftar mitra unik untuk pemilih filter, urut nama.
export function mitraPaymentOptions(rows: MitraPaymentRow[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.locationId)) m.set(r.locationId, r.locationName.trim() || 'Tanpa nama');
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export const MITRA_PAYMENT_EXCEL_HEADERS = ['No', 'Tanggal Bayar', 'Mitra', 'Tanggal Rekap', 'Dompet', 'Catatan', 'Dicatat Oleh', 'Status', 'Nominal'] as const;
// Baris Excel pembayaran (hanya yang diberikan); baris terakhir = total pembayaran aktif.
export function buildMitraPaymentExcelRows(rows: MitraPaymentRow[], fmtDate: (d: string) => string = d => d): { body: ExcelCell[][]; total: ExcelCell[] } {
  const body = rows.map((r, i): ExcelCell[] => [
    i + 1, fmtDate(r.date), r.locationName.trim() || 'Tanpa nama', fmtDate(r.recapDate), r.walletName ?? '-', r.note || '-', r.createdBy ?? '-',
    r.voided ? 'Dibatalkan' : 'Aktif', r.amount,
  ]);
  const s = summarizeMitraPayments(rows);
  return { body, total: ['', '', '', '', '', '', '', `TOTAL (${s.count} pembayaran)`, s.totalPaid] };
}
