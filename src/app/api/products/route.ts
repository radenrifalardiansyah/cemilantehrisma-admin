import { NextRequest, after } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { productUrl } from '@/lib/site';
import { revalidateStorefront } from '@/lib/revalidate';

// Short cache so bursts of near-simultaneous reads (dashboard load, POS stock
// refresh, multiple staff/tabs) collapse into one Firestore read instead of one
// each. Tagged so create/update/delete can invalidate it immediately instead of
// waiting out the 15s TTL.
const getCachedProducts = unstable_cache(
  async () => {
    const snap = await getDb().collection('products').orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-products'],
  { revalidate: 15, tags: ['admin-products'] }
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
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
  return Response.json({ id: ref.id, qrUrl });
}
