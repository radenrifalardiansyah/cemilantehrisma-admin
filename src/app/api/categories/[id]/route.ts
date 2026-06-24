import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const data   = await req.json() as Record<string, unknown>;
  await getDb().collection('categories').doc(id).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const db     = getDb();

  const used = await db.collection('products').where('category', '==', id).get();
  if (!used.empty) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${used.size} produk masih menggunakan kategori ini.` },
      { status: 400 },
    );
  }

  await db.collection('categories').doc(id).delete();
  return Response.json({ ok: true });
}
