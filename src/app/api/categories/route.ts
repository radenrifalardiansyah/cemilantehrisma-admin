import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const db   = getDb();
  const snap = await db.collection('categories').orderBy('order', 'asc').get();
  const categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ categories });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
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
