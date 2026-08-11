import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

const getCachedCustomers = unstable_cache(
  async () => {
    const snap = await getDb().collection('customers').orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-customers'],
  { revalidate: 15 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'customers', 'view');
  if (guard instanceof Response) return guard;
  const customers = await getCachedCustomers();
  return Response.json({ customers });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'customers', 'create');
  if (guard instanceof Response) return guard;
  const { name, phone, code, type, email, address, city, notes } =
    await req.json() as {
      name: string; phone: string; code?: string; type?: 'personal' | 'company';
      email?: string; address?: string; city?: string; notes?: string;
    };

  const phoneTrim = phone?.trim() ?? '';
  const codeTrim  = code?.trim() ?? '';

  if (!name?.trim()) {
    return Response.json({ error: 'Nama wajib diisi.' }, { status: 400 });
  }

  const db = getDb();
  const [phoneDup, codeDup] = await Promise.all([
    phoneTrim
      ? db.collection('customers').where('phone', '==', phoneTrim).limit(1).get()
      : null,
    codeTrim
      ? db.collection('customers').where('code', '==', codeTrim).limit(1).get()
      : null,
  ]);
  if (phoneDup && !phoneDup.empty) {
    return Response.json({ error: `No. HP "${phoneTrim}" sudah digunakan pelanggan lain.` }, { status: 409 });
  }
  if (codeDup && !codeDup.empty) {
    return Response.json({ error: `Kode "${codeTrim}" sudah digunakan pelanggan lain.` }, { status: 409 });
  }

  const ref = await db.collection('customers').add({
    name: name.trim(), phone: phoneTrim, code: codeTrim,
    type: type === 'company' ? 'company' : 'personal',
    email: email?.trim() ?? '', address: address?.trim() ?? '',
    city: city?.trim() ?? '', notes: notes?.trim() ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
