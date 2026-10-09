import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { canAccessStall } from '@/lib/stall-access';
import type { AuthUser } from '@/lib/admin-auth';
import type { StallRow } from '@/lib/consign-pg';
import { toTimestamp } from '@/lib/orders-pg';
import { consignUnitPricing } from '@/lib/stall-pos';

// Gerbang standar semua route Kasir Lapak: izin fitur 'stall-pos' + akses ke LAPAK tertentu
// (admin: semua; akun lain: hanya yang ditugaskan) + lapak harus ada. Pengecekan lapak dilakukan
// di server — menyembunyikan lapak di UI saja tidak cukup.
export async function guardStall(
  req: Request, action: 'view' | 'create' | 'delete', stallId: string | null,
): Promise<Response | { user: AuthUser; stall: StallRow }> {
  const user = await requirePermission(req, 'stall-pos', action);
  if (user instanceof Response) return user;
  if (!stallId) return Response.json({ error: 'Lapak wajib dipilih.' }, { status: 400 });
  if (!(await canAccessStall(user, stallId))) {
    return Response.json({ error: 'Anda tidak ditugaskan di lapak ini.' }, { status: 403 });
  }
  const sql = getSql();
  const [stall] = await sql<StallRow[]>`select * from stalls where id = ${stallId}`;
  if (!stall) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 404 });
  return { user, stall };
}

export interface ShiftRow {
  id: string; stall_id: string; opened_by: string | null; opening_balance: string; note: string; status: string;
  opened_at: Date; closed_at: Date | null; closed_by: string | null;
  cash_sales_total: string | null; expected_balance: string | null; actual_balance: string | null;
  difference: string | null; close_note: string | null;
}
const n = (v: string | null) => (v === null ? undefined : Number(v));
export function rowToShift(r: ShiftRow) {
  return {
    id: r.id, stallId: r.stall_id, openedBy: r.opened_by ?? '', openingBalance: Number(r.opening_balance), note: r.note, status: r.status,
    openedAt: toTimestamp(r.opened_at), closedAt: toTimestamp(r.closed_at), closedBy: r.closed_by ?? '',
    cashSalesTotal: n(r.cash_sales_total), expectedBalance: n(r.expected_balance), actualBalance: n(r.actual_balance),
    difference: n(r.difference), closeNote: r.close_note ?? '',
  };
}

export interface SaleItem {
  kind: 'own' | 'consign'; productId: string; name: string; unit: string; qty: number; price: number; subtotal: number;
  // own: HPP per unit saat transaksi. consign: penitip + bagi hasil per unit saat transaksi.
  costPrice?: number;
  consignorId?: string; consignorName?: string; scheme?: string; schemeValue?: number; consignorShare?: number; ourShare?: number;
}
export interface SaleRow {
  id: string; invoice_no: string; stall_id: string; stall_name: string; shift_id: string | null; date: string; cashier: string | null;
  items: unknown; subtotal: string; discount: string; total: string; payment_method: string; amount_paid: string; change_amount: string;
  note: string; status: string; void_reason: string | null; voided_by: string | null; voided_at: Date | null; created_at: Date;
}
export function rowToSale(r: SaleRow) {
  const items = typeof r.items === 'string' ? JSON.parse(r.items) as SaleItem[] : (r.items as SaleItem[]);
  return {
    id: r.id, invoiceNo: r.invoice_no, stallId: r.stall_id, stallName: r.stall_name, shiftId: r.shift_id ?? '', date: r.date,
    cashier: r.cashier ?? '', items, subtotal: Number(r.subtotal), discount: Number(r.discount), total: Number(r.total),
    paymentMethod: r.payment_method, amountPaid: Number(r.amount_paid), changeAmount: Number(r.change_amount), note: r.note,
    status: r.status, voidReason: r.void_reason ?? '', voidedBy: r.voided_by ?? '', voidedAt: toTimestamp(r.voided_at),
    createdAt: toTimestamp(r.created_at),
  };
}

// Error bisnis yang aman ditampilkan apa adanya ke kasir (dilempar dari dalam transaksi).
export class SaleError extends Error {}

export interface ConsignPricingRow {
  product_id: string; name: string; code: string | null; unit: string; default_price: string; p_scheme: string | null; p_value: string | null;
  si_price: string | null; si_scheme: string | null; si_value: string | null; stock_qty: string;
  consignor_id: string; consignor_name: string; c_scheme: string | null; c_value: string;
}

type Sch = 'nominal' | 'commission' | null;
const lvl = (scheme: string | null, value: string | null) => ({ scheme: scheme as Sch, value: value === null ? null : Number(value) });

// Harga & bagi hasil satu baris titipan di lapak (lapak → produk → default penitip).
export function pricingFromRow(r: ConsignPricingRow) {
  return consignUnitPricing({
    defaultPrice: Number(r.default_price), stallPrice: r.si_price === null ? null : Number(r.si_price),
    stallScheme: lvl(r.si_scheme, r.si_value), productScheme: lvl(r.p_scheme, r.p_value), consignorScheme: lvl(r.c_scheme, r.c_value),
  });
}
