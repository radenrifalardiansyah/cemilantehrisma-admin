import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

// Ulasan bintang dari akun storefront (koleksi `reviews`, dibuat lewat halaman
// /pesanan storefront). Baru dihitung ke rating publik di beranda storefront
// setelah di-approve di sini — lihat PATCH [id] untuk logika approve/reject.
const getCachedReviews = unstable_cache(
  async () => {
    const snap = await getDb().collection('reviews').orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-reviews'],
  { revalidate: 15 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'reviews', 'view');
  if (guard instanceof Response) return guard;
  const reviews = await getCachedReviews();
  return Response.json({ reviews });
}
