import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const snap = await getDb().collection('suppliers').orderBy('createdAt', 'asc').get();
  const suppliers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ suppliers });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('suppliers').add({
    name: data.name,
    phone: data.phone ?? '',
    address: data.address ?? '',
    note: data.note ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
