import { NextRequest } from 'next/server';
import { getBucket } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const folder = (form.get('folder') as string | null) ?? 'products';

  if (!file) return Response.json({ error: 'No file' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split('.').pop() ?? 'jpg';
  const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const bucket = getBucket();
  const fileRef = bucket.file(filename);
  await fileRef.save(buffer, { metadata: { contentType: file.type } });
  await fileRef.makePublic();

  const url = `https://storage.googleapis.com/${bucket.name}/${filename}`;
  return Response.json({ url });
}
