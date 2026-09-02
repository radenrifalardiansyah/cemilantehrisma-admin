import { parseJsonb } from '@/lib/db';
import { toTimestamp } from '@/lib/orders-pg';

// Versi Postgres dari dokumen `consignmentRecaps` (Tahap 13 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md). Shape JSON yang dikembalikan ke frontend dipertahankan sama
// persis seperti dokumen Firestore lama (camelCase, createdAt/dueDate/updatedAt/overdueNotifiedAt
// sebagai {seconds,nanoseconds}) supaya UI tidak perlu berubah — pola sama seperti orders-pg.ts.

export interface RecapRow {
  id: string;
  location_id: string;
  location_name: string;
  items: unknown;
  total_sold: string;
  total_retur: string;
  total_reject: string;
  total_revenue: string;
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
    totalRevenue: Number(r.total_revenue),
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
