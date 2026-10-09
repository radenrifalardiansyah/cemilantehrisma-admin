import { toTimestamp } from '@/lib/orders-pg';
import { parseJsonb } from '@/lib/db';
import { isShareScheme, type ShareScheme } from '@/lib/consign';

// Baris & mapper Postgres untuk modul Titip Jual (lihat scripts/create-consign.mjs).
// Kolom numeric dari postgres.js datang sebagai string → selalu lewat Number().

const num = (v: string | number | null): number => (v === null ? 0 : Number(v) || 0);
const numOrNull = (v: string | number | null): number | null => (v === null ? null : Number(v));

export interface StallRow {
  id: string; code: string | null; name: string; address: string; warehouse_id: string | null;
  note: string; is_active: boolean; invoice_prefix: string | null; created_at: Date; updated_at: Date | null;
}
export function rowToStall(r: StallRow) {
  return {
    id: r.id, code: r.code ?? '', name: r.name, address: r.address, warehouseId: r.warehouse_id ?? '',
    note: r.note, isActive: r.is_active, invoicePrefix: r.invoice_prefix ?? r.code ?? '', createdAt: toTimestamp(r.created_at),
  };
}

export interface ConsignorRow {
  id: string; code: string | null; name: string; phone: string; address: string;
  bank_name: string; bank_account: string; bank_holder: string; note: string; logo_url: string | null;
  scheme: ShareScheme | null; scheme_value: string | number; is_active: boolean; created_at: Date; updated_at: Date | null;
}
export function rowToConsignor(r: ConsignorRow) {
  return {
    id: r.id, code: r.code ?? '', name: r.name, phone: r.phone, address: r.address,
    bankName: r.bank_name, bankAccount: r.bank_account, bankHolder: r.bank_holder, note: r.note, logoUrl: r.logo_url ?? '',
    scheme: r.scheme, schemeValue: num(r.scheme_value), isActive: r.is_active, createdAt: toTimestamp(r.created_at),
  };
}

export interface ConsignProductRow {
  id: string; code: string | null; consignor_id: string; name: string; unit: string;
  default_price: string | number; scheme: ShareScheme | null; scheme_value: string | number | null;
  note: string; is_active: boolean; created_at: Date; updated_at: Date | null;
}
export function rowToConsignProduct(r: ConsignProductRow) {
  return {
    id: r.id, code: r.code ?? '', consignorId: r.consignor_id, name: r.name, unit: r.unit,
    defaultPrice: num(r.default_price), scheme: r.scheme, schemeValue: numOrNull(r.scheme_value),
    note: r.note, isActive: r.is_active, createdAt: toTimestamp(r.created_at),
  };
}

export interface StallItemRow {
  id: string; product_id: string; stall_id: string; price: string | number | null;
  scheme: ShareScheme | null; scheme_value: string | number | null; stock_qty: string | number;
}
export function rowToStallItem(r: StallItemRow) {
  return {
    id: r.id, productId: r.product_id, stallId: r.stall_id, price: numOrNull(r.price),
    scheme: r.scheme, schemeValue: numOrNull(r.scheme_value), stockQty: num(r.stock_qty),
  };
}

export interface ReceiptItem { productId: string; productName: string; unit: string; qty: number }
export interface ReceiptRow {
  id: string; doc_number: string; kind: 'in' | 'return'; consignor_id: string; consignor_name: string;
  stall_id: string; stall_name: string; doc_date: string; items: unknown; total_qty: string | number;
  note: string; created_by: string | null; created_at: Date;
}
export function rowToReceipt(r: ReceiptRow) {
  return {
    id: r.id, docNumber: r.doc_number, kind: r.kind, consignorId: r.consignor_id, consignorName: r.consignor_name,
    stallId: r.stall_id, stallName: r.stall_name, docDate: r.doc_date,
    items: parseJsonb<ReceiptItem[]>(r.items as ReceiptItem[] | string | null) ?? [],
    totalQty: num(r.total_qty), note: r.note, createdBy: r.created_by ?? '', createdAt: toTimestamp(r.created_at),
  };
}

// Kode berurutan (mis. PNT001, LPK001, TJP001). Selalu lewat angka terbesar yang ada +1.
export function nextCode(prefix: string, existing: (string | null)[]): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  for (const c of existing) {
    const m = re.exec((c ?? '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// Baca konfigurasi skema opsional dari body request. `null` = ikut tingkat di atasnya.
export function parseSchemeInput(
  scheme: unknown, value: unknown,
): { scheme: ShareScheme | null; value: number | null } | { error: string } {
  if (scheme === null || scheme === undefined || scheme === '') return { scheme: null, value: null };
  if (!isShareScheme(scheme)) return { error: 'Skema bagi hasil tidak valid.' };
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return { error: 'Nilai bagi hasil tidak valid.' };
  return { scheme, value: v };
}
