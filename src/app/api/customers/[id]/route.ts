import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const doc = await getDb().collection('customers').doc(id).get();
  if (!doc.exists) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ id: doc.id, ...doc.data() });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
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
      ? db.collection('customers').where('phone', '==', phoneTrim).limit(2).get()
      : null,
    codeTrim
      ? db.collection('customers').where('code', '==', codeTrim).limit(2).get()
      : null,
  ]);
  if (phoneDup && phoneDup.docs.some(d => d.id !== id)) {
    return Response.json({ error: `No. HP "${phoneTrim}" sudah digunakan pelanggan lain.` }, { status: 409 });
  }
  if (codeDup && codeDup.docs.some(d => d.id !== id)) {
    return Response.json({ error: `Kode "${codeTrim}" sudah digunakan pelanggan lain.` }, { status: 409 });
  }

  await db.collection('customers').doc(id).update({
    name: name.trim(), phone: phoneTrim, code: codeTrim,
    type: type === 'company' ? 'company' : 'personal',
    email: email?.trim() ?? '', address: address?.trim() ?? '',
    city: city?.trim() ?? '', notes: notes?.trim() ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  await getDb().collection('customers').doc(id).delete();
  return Response.json({ ok: true });
}
