import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const snap = await getDb().collection('rawMaterials').orderBy('createdAt', 'asc').get();
  const materials = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ materials });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('rawMaterials').add({
    name: data.name,
    unit: data.unit ?? '',
    minStock: Number(data.minStock) || 0,
    stockQty: 0,
    avgCost: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
