import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

interface ImportRow {
  code?: string; name: string; category: string;
  price: number; originalPrice?: number; weight?: string;
  stockQty?: number; openPO?: boolean; badge?: string; description?: string;
}

const BATCH_LIMIT = 400;

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { products } = await req.json() as { products: ImportRow[] };
  if (!Array.isArray(products) || products.length === 0) {
    return Response.json({ error: 'Tidak ada data produk untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const existingSnap = await db.collection('products').get();
  const existingCodes = new Set(
    existingSnap.docs.map(d => ((d.data().code as string) ?? '').trim()).filter(Boolean),
  );
  const seenCodes = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  for (const row of products) {
    const name     = (row.name ?? '').toString().trim();
    const category = (row.category ?? '').toString().trim();
    const code     = (row.code ?? '').toString().trim();
    const price    = Number(row.price) || 0;
    if (!name || !category || price <= 0) { skippedInvalid++; continue; }
    if (code && (existingCodes.has(code) || seenCodes.has(code))) { skippedDuplicate++; continue; }

    if (code) seenCodes.add(code);
    const stockQty = Number(row.stockQty) || 0;
    const openPO   = !!row.openPO;
    const ref = db.collection('products').doc();
    batch.set(ref, {
      name, code, category,
      price, originalPrice: row.originalPrice || null,
      weight: (row.weight ?? '').toString().trim(),
      description: (row.description ?? '').toString().trim(),
      details: [''], badge: (row.badge ?? '').toString().trim(),
      emoji: '🛍️', imageUrls: [],
      gradient: 'from-amber-700 to-yellow-500', bgColor: '#B45309',
      stockQty, openPO,
      stock: openPO ? 'open_po' : stockQty > 0 ? 'ready' : 'habis',
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
