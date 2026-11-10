import { parseJsonb } from '@/lib/db';
import { toTimestamp } from '@/lib/orders-pg';

// Versi Postgres dari dokumen `consignmentRecaps` (Tahap 13 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md). Shape JSON yang dikembalikan ke frontend dipertahankan sama
// persis seperti dokumen Firestore lama (camelCase, createdAt/dueDate/updatedAt/overdueNotifiedAt
// sebagai {seconds,nanoseconds}) supaya UI tidak perlu berubah — pola sama seperti orders-pg.ts.

export interface RecapOtherCost { label: string; amount: number }

// Biaya lain-lain rekap (biaya admin, ongkir, dll.) — memotong jumlah rekap. Baris kosong/<=0 dibuang.
export function sanitizeOtherCosts(input: unknown): RecapOtherCost[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(c => ({ label: String((c as RecapOtherCost)?.label ?? '').trim().slice(0, 80), amount: Math.round(Number((c as RecapOtherCost)?.amount) || 0) }))
    .filter(c => c.amount > 0)
    .map(c => ({ ...c, label: c.label || 'Biaya lain' }));
}

export interface RecapRow {
  id: string;
  location_id: string;
  location_name: string;
  items: unknown;
  total_sold: string;
  total_retur: string;
  total_reject: string;
  total_revenue: string;
  other_costs: unknown;
  total_other_costs: string | null;
  payment_status: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  note: string | null;
  wallet_id: string | null;
  due_date: Date | null;
  overdue_notified_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
}

export function rowToRecap(r: RecapRow) {
  return {
    id: r.id,
    locationId: r.location_id,
    locationName: r.location_name,
    items: parseJsonb(r.items) ?? [],
    totalSold: Number(r.total_sold),
    totalRetur: Number(r.total_retur),
    totalReject: Number(r.total_reject),
    // totalRevenue = NETTO (sudah dipotong biaya lain-lain) — inilah yang dibaca saldo dompet & laporan.
    totalRevenue: Number(r.total_revenue),
    otherCosts: (parseJsonb(r.other_costs) ?? []) as RecapOtherCost[],
    totalOtherCosts: Number(r.total_other_costs ?? 0),
    grossRevenue: Number(r.total_revenue) + Number(r.total_other_costs ?? 0),
    paymentStatus: r.payment_status,
    warehouseId: r.warehouse_id ?? '',
    warehouseName: r.warehouse_name ?? '',
    note: r.note ?? '',
    walletId: r.wallet_id,
    dueDate: toTimestamp(r.due_date),
    overdueNotifiedAt: toTimestamp(r.overdue_notified_at),
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}
