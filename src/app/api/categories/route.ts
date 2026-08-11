import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

const getCachedCategories = unstable_cache(
  async () => {
    const snap = await getDb().collection('categories').orderBy('order', 'asc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-categories'],
  { revalidate: 15 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'categories', 'view');
  if (guard instanceof Response) return guard;
  const categories = await getCachedCategories();
  return Response.json({ categories });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'categories', 'create');
  if (guard instanceof Response) return guard;
  const { slug, name, emoji, description, order, bannerUrl } =
    await req.json() as { slug: string; name: string; emoji: string; description?: string; order?: number; bannerUrl?: string };

  if (!slug || !name) return Response.json({ error: 'Slug dan nama wajib diisi.' }, { status: 400 });

  const db  = getDb();
  const ref = db.collection('categories').doc(slug);
  if ((await ref.get()).exists) {
    return Response.json({ error: `Kategori dengan ID "${slug}" sudah ada.` }, { status: 409 });
  }

  await ref.set({
    name, emoji: emoji || '🏷️', description: description ?? '',
    order: order ?? 99, bannerUrl: bannerUrl ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: slug });
}
