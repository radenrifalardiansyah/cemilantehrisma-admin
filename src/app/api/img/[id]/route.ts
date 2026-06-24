import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const db  = getDb();
  const doc = await db.collection('images').doc(id).get();

  if (!doc.exists) {
    return new Response('Not found', { status: 404 });
  }

  const { data, contentType } = doc.data() as { data: Buffer; contentType: string };

  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': contentType ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
