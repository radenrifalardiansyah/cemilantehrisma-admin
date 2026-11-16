// Bagian MURNI (tanpa DB/server) Riwayat Pembayaran Hutang Supplier: tipe, ringkasan, filter klien, dan baris Excel.
// Dipakai rute GET /api/material-purchases/payments dan SupplierPayablesPanel; diuji langsung.

export const PAYMENTS_LIMIT = 1000;

export interface SupplierPaymentRow {
  id: string; purchaseId: string; date: string; amount: number;
  supplierId: string | null; supplierName: string;
  poNumber: string | null; grNumber: string | null;
  walletId: string | null; walletName: string | null;
  note: string; createdBy: string | null;
  /** Pembayaran ini dibatalkan ATAU pembelian induknya dibatalkan (tidak dihitung ke total). */
  voided: boolean;
  /** Pembelian induk dibatalkan (penanda terpisah dari pembayaran yang dibatalkan sendiri). */
  purchaseVoided: boolean;
  createdAt: string;
}

export interface SupplierPaymentsSummary { count: number; totalPaid: number; supplierCount: number; voidedCount: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

export const paymentSupplierKey = (r: Pick<SupplierPaymentRow, 'supplierId' | 'supplierName'>) =>
  r.supplierId ? `id:${r.supplierId}` : `name:${(r.supplierName ?? '').trim().toLowerCase()}`;

// Pembayaran void tidak masuk count/total/supplierCount; hanya dihitung di voidedCount.
export function summarizeSupplierPayments(rows: SupplierPaymentRow[]): SupplierPaymentsSummary {
  const suppliers = new Set<string>();
  const s: SupplierPaymentsSummary = { count: 0, totalPaid: 0, supplierCount: 0, voidedCount: 0 };
  for (const r of rows) {
    if (r.voided) { s.voidedCount += 1; continue; }
    s.count += 1;
    s.totalPaid = r2(s.totalPaid + r.amount);
    suppliers.add(paymentSupplierKey(r));
  }
  s.supplierCount = suppliers.size;
  return s;
}

// Tanggal bayar terbaru dulu; sama tanggal: waktu catat terbaru dulu, lalu id agar stabil.
export const comparePaymentsNewestFirst = (a: SupplierPaymentRow, b: SupplierPaymentRow) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

// Filter klien: supplier (key dari paymentSupplierKey, '' = semua) dan kata kunci (supplier/PO/GR/catatan/dompet).
export function filterSupplierPayments(rows: SupplierPaymentRow[], opts: { supplierKey?: string; search?: string }): SupplierPaymentRow[] {
  const q = (opts.search ?? '').trim().toLowerCase();
  return rows.filter(r =>
    (!opts.supplierKey || paymentSupplierKey(r) === opts.supplierKey)
    && (!q || [r.supplierName, r.poNumber, r.grNumber, r.note, r.walletName].some(t => (t ?? '').toLowerCase().includes(q))));
}

// Daftar supplier unik untuk pemilih filter, urut nama.
export function paymentSupplierOptions(rows: SupplierPaymentRow[]): { key: string; name: string }[] {
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(paymentSupplierKey(r))) m.set(paymentSupplierKey(r), r.supplierName.trim() || 'Tanpa nama');
  return [...m].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export const paymentDocLabel = (r: Pick<SupplierPaymentRow, 'poNumber' | 'grNumber'>) =>
  [r.poNumber, r.grNumber].filter(Boolean).join(' · ') || 'Pembelian manual';

export type PaymentExcelCell = string | number;
// Baris Excel (hanya yang diberikan); baris terakhir = total pembayaran aktif. Kolom sesuai tabel + Status.
export const PAYMENT_EXCEL_HEADERS = ['No', 'Tanggal Bayar', 'Supplier', 'PO/GR', 'Dompet', 'Catatan', 'Dibayar Oleh', 'Status', 'Nominal'] as const;
export function buildPaymentExcelRows(rows: SupplierPaymentRow[], fmtDate: (d: string) => string = d => d): { body: PaymentExcelCell[][]; total: PaymentExcelCell[] } {
  const body = rows.map((r, i): PaymentExcelCell[] => [
    i + 1, fmtDate(r.date), r.supplierName || 'Tanpa nama', paymentDocLabel(r), r.walletName ?? '-', r.note || '-', r.createdBy ?? '-',
    r.voided ? 'Dibatalkan' : 'Aktif', r.amount,
  ]);
  const s = summarizeSupplierPayments(rows);
  return { body, total: ['', '', '', '', '', '', '', `TOTAL (${s.count} pembayaran)`, s.totalPaid] };
}
