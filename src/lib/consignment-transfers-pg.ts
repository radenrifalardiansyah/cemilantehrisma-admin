import { parseJsonb } from '@/lib/db';
import { toTimestamp } from '@/lib/orders-pg';
import { normalizeTransferStatus } from '@/lib/consignment-transfer-status';

// Dokumen `consignment_transfers` (Transfer Stok Antar Mitra). Shape JSON ke frontend: camelCase,
// timestamp {seconds,nanoseconds} — pola sama seperti shipments-pg.ts.

// Tag cache: daftar transfer, dan analitik mitra (dibuang saat transfer di-approve/dibatalkan).
export const TRANSFERS_LIST_TAG = 'admin-consignment-transfers-list';
export const CONSIGNMENT_ANALYTICS_TAG = 'admin-analytics-consignment';

export interface TransferItemRow { productId: string; productName: string; qty: number; hargaTitip: number }

export interface ConsignmentTransferRow {
  id: string;
  doc_number: string;
  from_location_id: string;
  to_location_id: string;
  from_location_name: string | null;
  to_location_name: string | null;
  items: unknown;
  note: string | null;
  doc_date: Date;
  status: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  rejected_by: string | null;
  rejected_at: Date | null;
  reject_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
}

export function rowToTransfer(r: ConsignmentTransferRow) {
  return {
    id: r.id,
    docNumber: r.doc_number,
    fromLocationId: r.from_location_id,
    fromLocationName: r.from_location_name ?? '',
    toLocationId: r.to_location_id,
    toLocationName: r.to_location_name ?? '',
    items: (parseJsonb(r.items as string | TransferItemRow[] | null) as TransferItemRow[] | null) ?? [],
    note: r.note ?? '',
    docDate: toTimestamp(r.doc_date),
    status: normalizeTransferStatus(r.status),
    createdBy: r.created_by ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: toTimestamp(r.approved_at),
    rejectedBy: r.rejected_by ?? null,
    rejectedAt: toTimestamp(r.rejected_at),
    rejectReason: r.reject_reason ?? null,
    cancelledBy: r.cancelled_by ?? null,
    cancelledAt: toTimestamp(r.cancelled_at),
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}
export type ConsignmentTransfer = ReturnType<typeof rowToTransfer>;
