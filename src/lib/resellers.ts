import { FieldValue, Firestore } from 'firebase-admin/firestore';

export type ManualCustomer = { name: string; phone?: string; address?: string; city?: string };
export type ResellerStatus = 'pending' | 'approved' | 'rejected';
export const RESELLER_STATUSES: ResellerStatus[] = ['pending', 'approved', 'rejected'];

export async function resolveCustomerId(
  db: Firestore,
  body: { customerId?: string; customer?: ManualCustomer },
) {
  if (body.customerId?.trim()) {
    const id = body.customerId.trim();
    const doc = await db.collection('customers').doc(id).get();
    if (!doc.exists) return { error: 'Pelanggan tidak ditemukan.', status: 404 } as const;
    return { customerId: id } as const;
  }

  const manual = body.customer;
  if (!manual?.name?.trim()) {
    return { error: 'Pilih pelanggan atau isi nama pelanggan baru.', status: 400 } as const;
  }

  const phoneTrim = manual.phone?.trim() ?? '';
  if (phoneTrim) {
    const dup = await db.collection('customers').where('phone', '==', phoneTrim).limit(1).get();
    if (!dup.empty) {
      return { error: `No. HP "${phoneTrim}" sudah terdaftar sebagai pelanggan lain. Pilih pelanggan tersebut dari daftar.`, status: 409 } as const;
    }
  }

  const ref = await db.collection('customers').add({
    name: manual.name.trim(), phone: phoneTrim, code: '',
    type: 'personal', email: '', address: manual.address?.trim() ?? '',
    city: manual.city?.trim() ?? '', notes: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { customerId: ref.id } as const;
}
