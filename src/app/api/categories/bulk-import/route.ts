import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

interface ImportRow {
  slug?: string; name: string; emoji?: string; description?: string;
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

const BATCH_LIMIT = 400;

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { categories } = await req.json() as { categories: ImportRow[] };
  if (!Array.isArray(categories) || categories.length === 0) {
    return Response.json({ error: 'Tidak ada data kategori untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const existingSnap = await db.collection('categories').get();
  const existingSlugs = new Set(existingSnap.docs.map(d => d.id));
  const seenSlugs = new Set<string>();
  let nextOrder = existingSnap.size + 1;

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  for (const row of categories) {
    const name = (row.name ?? '').toString().trim();
    if (!name) { skippedInvalid++; continue; }
    const slug = (row.slug ?? '').toString().trim() || slugify(name);
    if (!slug || existingSlugs.has(slug) || seenSlugs.has(slug)) { skippedDuplicate++; continue; }

    seenSlugs.add(slug);
    const ref = db.collection('categories').doc(slug);
    batch.set(ref, {
      name, emoji: (row.emoji ?? '').toString().trim() || '🏷️',
      description: (row.description ?? '').toString().trim(),
      order: nextOrder++, bannerUrl: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    created++;
    opsInBatch++;

    if (opsInBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
