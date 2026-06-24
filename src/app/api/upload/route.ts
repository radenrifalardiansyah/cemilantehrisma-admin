import { NextRequest } from 'next/server';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Browser compresses before sending (max ~1200px, quality 0.82) so typical upload is 80–200 KB.
// 900 KB is a hard guard in case someone uploads without the client-side compress path.
const MAX_BYTES = 900_000;

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return Response.json({ error: 'No file' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.byteLength > MAX_BYTES) {
    return Response.json(
      { error: `Gambar terlalu besar (${(buffer.byteLength / 1024).toFixed(0)} KB). Maks 900 KB. Kompres gambar di browser gagal — coba pilih file yang lebih kecil.` },
      { status: 413 },
    );
  }

  const db = getDb();
  const ref = await db.collection('images').add({
    data:         buffer,
    contentType:  file.type || 'image/jpeg',
    originalName: file.name,
    size:         buffer.byteLength,
    createdAt:    FieldValue.serverTimestamp(),
  });

  const origin = req.nextUrl.origin;
  return Response.json({ url: `${origin}/api/img/${ref.id}` });
}
