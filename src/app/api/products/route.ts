import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { productUrl } from '@/lib/site';

// Short cache so bursts of near-simultaneous reads (dashboard load, POS stock
// refresh, multiple staff/tabs) collapse into one Firestore read instead of one
// each. 15s keeps admin edits feeling near-instant while still absorbing bursts.
const getCachedProducts = unstable_cache(
  async () => {
    const snap = await getDb().collection('products').orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-products'],
  { revalidate: 15 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'view');
  if (guard instanceof Response) return guard;
  const products = await getCachedProducts();
  return Response.json({ products });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = db.collection('products').doc();
  const qrUrl = (data.qrUrl as string | undefined)?.trim() || productUrl(ref.id);
  await ref.set({
    ...data,
    qrUrl,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id, qrUrl });
}
