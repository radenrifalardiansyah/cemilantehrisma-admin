import { randomUUID } from 'crypto';
import { getSql } from '@/lib/db';

export type ManualCustomer = { name: string; phone?: string; address?: string; city?: string };
export type ResellerStatus = 'pending' | 'approved' | 'rejected';
export const RESELLER_STATUSES: ResellerStatus[] = ['pending', 'approved', 'rejected'];

// `db: Firestore` dihapus dari signature (Tahap 21 — customers/resellers pindah ke Postgres,
// lihat plan gleaming-wondering-quokka.md); caller sudah diperbarui untuk tidak mengirimkannya lagi.
export async function resolveCustomerId(
  body: { customerId?: string; customer?: ManualCustomer },
) {
  const sql = getSql();
  if (body.customerId?.trim()) {
    const id = body.customerId.trim();
    const [row] = await sql<{ id: string }[]>`select id from customers where id = ${id}`;
    if (!row) return { error: 'Pelanggan tidak ditemukan.', status: 404 } as const;
    return { customerId: id } as const;
  }

  const manual = body.customer;
  if (!manual?.name?.trim()) {
    return { error: 'Pilih pelanggan atau isi nama pelanggan baru.', status: 400 } as const;
  }

  const phoneTrim = manual.phone?.trim() ?? '';
  if (phoneTrim) {
    const [dup] = await sql<{ id: string }[]>`select id from customers where phone = ${phoneTrim} limit 1`;
    if (dup) {
      return { error: `No. HP "${phoneTrim}" sudah terdaftar sebagai pelanggan lain. Pilih pelanggan tersebut dari daftar.`, status: 409 } as const;
    }
  }

  const id = randomUUID();
  await sql`
    insert into customers (id, name, phone, code, type, email, address, city, notes, created_at, updated_at)
    values (${id}, ${manual.name.trim()}, ${phoneTrim}, '', 'personal', '', ${manual.address?.trim() ?? ''}, ${manual.city?.trim() ?? ''}, '', now(), now())
  `;
  return { customerId: id } as const;
}
