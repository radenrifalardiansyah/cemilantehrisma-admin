import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { WAREHOUSES_LIST_VIEW_KEYS } from '@/lib/permissions';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

// Opened whenever the Gudang tab is opened, not on every session — plain TTL is enough.
const getCachedWarehouses = unstable_cache(
  async () => {
    const snap = await getDb().collection('warehouses').orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-warehouses'],
  { revalidate: 20 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, WAREHOUSES_LIST_VIEW_KEYS, 'view');
  if (guard instanceof Response) return guard;
  const warehouses = await getCachedWarehouses();
  return Response.json({ warehouses });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const payload = {
    name: data.name,
    location: data.location ?? '',
    description: data.description ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection('warehouses').add(payload);

  try {
    await logHistory(db, {
      entity: 'warehouses',
      entityId: ref.id,
      entityLabel: (data.name as string) ?? ref.id,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch {
    // audit log failure must never fail the business request
  }

  return Response.json({ id: ref.id });
}
