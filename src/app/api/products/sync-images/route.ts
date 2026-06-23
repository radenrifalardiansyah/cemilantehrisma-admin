import { NextRequest } from 'next/server';
import { getDb, getBucket } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// Mapping product ID → image filenames in public/images/products/
const IMAGE_MAP: Record<string, string[]> = {
  'mk-ori-150':  ['Mie Kremes 150g Original.png', 'Mie Kremes 100g Rasa Original.jpeg', 'Produk Mie Kremes Original dan Pedas.jpeg'],
  'mk-pdas-150': ['Mie Kremes 150g Pedas.png', 'Mie Kremes 100g Rasa Pedas.jpeg', 'Produk Mie Kremes Original dan Pedas.jpeg'],
  'kk-ori-100':  ['Keripik Kimpul 100g Original.png'],
  'kk-bbq-100':  ['Keripik Kimpul 100g BBQ Pedas.png', 'Kimpul BBQ Pedas.jpeg'],
  'kk-jgn-100':  ['Keripik Kimpul 100g Jagung.png'],
  'kk-ori-250':  ['Keripik Kimpul 250g Original.png', 'Kimpul All.jpeg'],
  'kk-bbq-250':  ['Keripik Kimpul 250g BBQ Pedas.png', 'Kimpul BBQ Pedas.jpeg'],
  'kk-jgn-250':  ['Keripik Kimpul 250g Jagung.png', 'Kimpul All 1.jpeg'],
  'pk-mix3':     ['Kimpul All.jpeg', 'Kimpul All 1.jpeg'],
  'pk-mix5':     ['Kimpul All 1.jpeg', 'Kimpul All.jpeg'],
  'pk-campur':   ['Product All Mie Kremes.jpeg', 'Product All Mie Kremes 1.jpeg'],
};

const CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();

  const db     = getDb();
  const bucket = getBucket();
  const imgDir = path.join(process.cwd(), 'public', 'images', 'products');

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [productId, filenames] of Object.entries(IMAGE_MAP)) {
    const ref  = db.collection('products').doc(productId);
    const snap = await ref.get();
    if (!snap.exists) { skipped++; continue; }

    const data = snap.data() as { imageUrls?: string[] };
    if (data.imageUrls && data.imageUrls.length > 0) { skipped++; continue; }

    const urls: string[] = [];

    for (const filename of filenames) {
      const filePath = path.join(imgDir, filename);
      if (!fs.existsSync(filePath)) { errors.push(`File not found: ${filename}`); continue; }

      const buffer = fs.readFileSync(filePath);
      const ext    = filename.split('.').pop()?.toLowerCase() ?? 'jpeg';
      const dest   = `products/${productId}/${filename}`;

      try {
        const fileRef = bucket.file(dest);
        await fileRef.save(buffer, { metadata: { contentType: CONTENT_TYPE[ext] ?? 'image/jpeg' } });
        await fileRef.makePublic();
        urls.push(`https://storage.googleapis.com/${bucket.name}/${dest}`);
      } catch (e) {
        errors.push(`Upload failed: ${filename} — ${e}`);
      }
    }

    if (urls.length > 0) {
      await ref.update({ imageUrls: urls, updatedAt: FieldValue.serverTimestamp() });
      updated++;
    }
  }

  return Response.json({ updated, skipped, errors });
}
