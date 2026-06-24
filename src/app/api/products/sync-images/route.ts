import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// product-id → filenames in public/images/products/
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

const NAME_HINTS: [string, string][] = [
  ['mie kremes original', 'mk-ori-150'],
  ['mie kremes pedas',    'mk-pdas-150'],
  ['kimpul original',     'kk-ori-100'],
  ['kimpul bbq',          'kk-bbq-100'],
  ['kimpul jagung',       'kk-jgn-100'],
  ['original jumbo',      'kk-ori-250'],
  ['bbq pedas jumbo',     'kk-bbq-250'],
  ['jagung jumbo',        'kk-jgn-250'],
  ['mix 3',               'pk-mix3'],
  ['mix 5',               'pk-mix5'],
  ['campur',              'pk-campur'],
];

function mapKey(productId: string, productName: string): string {
  if (IMAGE_MAP[productId]) return productId;
  const lower = productName.toLowerCase();
  for (const [hint, key] of NAME_HINTS) {
    if (lower.includes(hint)) return key;
  }
  return '';
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();

  const db     = getDb();
  const imgDir = path.join(process.cwd(), 'public', 'images', 'products');

  if (!fs.existsSync(imgDir)) {
    return Response.json({ error: `Folder gambar tidak ditemukan: ${imgDir}` }, { status: 500 });
  }

  // Base URL of this admin panel — used to build static image URLs from public/
  const origin = req.nextUrl.origin;

  const snap    = await db.collection('products').get();
  const allDocs = snap.docs.map(d => ({ id: d.id, ...(d.data() as { name?: string; imageUrls?: string[] }) }));

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const log: string[]    = [];

  for (const doc of allDocs) {
    if (doc.imageUrls && doc.imageUrls.length > 0) { skipped++; continue; }

    const key = mapKey(doc.id, doc.name ?? '');
    if (!key) { log.push(`Tidak ada mapping gambar: ${doc.id} (${doc.name})`); skipped++; continue; }

    const filenames = IMAGE_MAP[key];
    const urls: string[] = [];

    for (const filename of filenames) {
      const filePath = path.join(imgDir, filename);
      if (!fs.existsSync(filePath)) { errors.push(`File tidak ada: ${filename}`); continue; }

      // Gambar sudah ada di public/ — langsung simpan URL-nya tanpa upload ke mana pun
      urls.push(`${origin}/images/products/${encodeURIComponent(filename)}`);
    }

    if (urls.length > 0) {
      await db.collection('products').doc(doc.id).update({
        imageUrls: urls,
        updatedAt: FieldValue.serverTimestamp(),
      });
      updated++;
    }
  }

  return Response.json({ updated, skipped, errors, log, total: allDocs.length });
}
