import { NextRequest } from 'next/server';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { uploadToCloudinary, cloudinaryConfigured } from '@/lib/cloudinary';

// Browser compresses before sending (max ~1200px, quality 0.82) so typical upload is 80–200 KB.
// 900 KB is a hard guard in case someone uploads without the client-side compress path.
const MAX_BYTES = 900_000;

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();

  if (!cloudinaryConfigured()) {
    return Response.json(
      { error: 'Cloudinary belum dikonfigurasi. Tambahkan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, dan CLOUDINARY_API_SECRET ke environment variables.' },
      { status: 500 },
    );
  }

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

  try {
    const url = await uploadToCloudinary(buffer, file.name, 'uploads', file.type || 'image/jpeg');
    return Response.json({ url });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Upload ke Cloudinary gagal.' }, { status: 502 });
  }
}
