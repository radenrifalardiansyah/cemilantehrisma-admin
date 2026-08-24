import { NextRequest, after } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidateStorefront } from '@/lib/revalidate';

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
  const { slug, name, emoji, description, bannerUrl } =
    await req.json() as { slug: string; name: string; emoji: string; description?: string; order?: number; bannerUrl?: string };

  if (!slug || !name) return Response.json({ error: 'Slug dan nama wajib diisi.' }, { status: 400 });

  const db  = getDb();
  const ref = db.collection('categories').doc(slug);
  const [existing, siblingSnap] = await Promise.all([ref.get(), db.collection('categories').get()]);
  if (existing.exists) {
    return Response.json({ error: `Kategori dengan ID "${slug}" sudah ada.` }, { status: 409 });
  }

  // max(order)+1 dihitung SERVER-SIDE, bukan dipercaya dari klien (yang sebelumnya kirim
  // `categories.length + 1` — bisa bentrok dengan order kategori lain yang masih ada begitu
  // pernah ada penghapusan, karena jumlah kategori menyusut tapi nilai order yang tersisa tidak
  // ikut dipadatkan ulang; lihat komentar sama di api/menus & api/modules route.ts POST).
  const nextOrder = siblingSnap.docs.reduce((max, d) => Math.max(max, Number(d.data().order) || 0), -1) + 1;

  await ref.set({
    name, emoji: emoji || '🏷️', description: description ?? '',
    order: nextOrder, bannerUrl: bannerUrl ?? '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  after(() => revalidateStorefront('categories'));
  return Response.json({ id: slug });
}
