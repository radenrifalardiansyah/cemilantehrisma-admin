import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { WAREHOUSES_LIST_VIEW_KEYS } from '@/lib/permissions';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, WAREHOUSES_LIST_VIEW_KEYS, 'view');
  if (guard instanceof Response) return guard;
  const snap = await getDb().collection('warehouses').orderBy('createdAt', 'asc').get();
  const warehouses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ warehouses });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('warehouses').add({
    name: data.name,
    location: data.location ?? '',
    description: data.description ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id });
}
