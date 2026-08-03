import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const snap = await getDb().collection('rawMaterials').orderBy('createdAt', 'asc').get();
  const materials = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ materials });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('rawMaterials').add({
    name: data.name,
    unit: data.unit ?? '',
    stockQty: 0,
    avgCost: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
