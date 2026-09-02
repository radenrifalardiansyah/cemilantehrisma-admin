import { toTimestamp } from '@/lib/orders-pg';

// Versi Postgres dari `suppliers` (Tahap 20 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md).

export interface SupplierRow {
  id: string; code: string | null; name: string; phone: string; address: string; note: string;
  created_at: Date; updated_at: Date | null;
}

export function rowToSupplier(r: SupplierRow) {
  return {
    id: r.id, code: r.code ?? undefined, name: r.name, phone: r.phone, address: r.address, note: r.note,
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}

const SUPPLIER_CODE_PREFIX = 'SUP';

export function nextSupplierCode(existingCodes: string[]): string {
  let max = 0;
  for (const c of existingCodes) {
    const m = new RegExp(`^${SUPPLIER_CODE_PREFIX}(\\d+)$`, 'i').exec(c.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${SUPPLIER_CODE_PREFIX}${String(max + 1).padStart(3, '0')}`;
}
