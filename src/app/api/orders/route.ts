import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const db = getDb();
  const snap = await db.collection('orders').orderBy('createdAt', 'desc').limit(limit).get();
  const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ orders });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('orders').add({
    ...data,
    status: 'done',
    createdAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
