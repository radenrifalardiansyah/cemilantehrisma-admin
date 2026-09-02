import { toTimestamp } from '@/lib/orders-pg';

// Versi Postgres dari `customers` & `resellers` (Tahap 21 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md). `resellers` selalu digabung dengan data `customers`-nya
// (nama/telepon/dsb ikut ditampilkan), jadi mapper keduanya digabung di satu file ini.

export interface CustomerRow {
  id: string; name: string; phone: string; code: string | null; type: string;
  email: string | null; address: string | null; city: string | null; notes: string | null;
  created_at: Date; updated_at: Date | null;
}

export function rowToCustomer(r: CustomerRow) {
  return {
    id: r.id, name: r.name, phone: r.phone, code: r.code ?? undefined,
    type: r.type === 'company' ? 'company' : 'personal',
    email: r.email ?? '', address: r.address ?? '', city: r.city ?? '', notes: r.notes ?? '',
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}

export interface ResellerRow {
  id: string; customer_id: string | null; bank_name: string | null; bank_account: string | null;
  bank_holder: string | null; status: string; created_at: Date; updated_at: Date | null;
}
