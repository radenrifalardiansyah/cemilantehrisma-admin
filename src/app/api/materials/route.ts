import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

// Was the one uncached GET in the dashboard's fetch fan-out (products/customers/resellers
// etc. already use this same pattern) — fires on every session restore.
const getCachedMaterials = unstable_cache(
  async () => {
    const snap = await getDb().collection('rawMaterials').orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-materials'],
  { revalidate: 15, tags: ['admin-materials'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const materials = await getCachedMaterials();
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
  revalidateTag('admin-materials', { expire: 0 });
  return Response.json({ id: ref.id });
}
