import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const db = getDb();
  const snap = await db.collection('products').orderBy('createdAt', 'desc').get();
  const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ products });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('products').add({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
