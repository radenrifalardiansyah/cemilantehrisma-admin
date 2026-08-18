import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'categories', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data   = await req.json() as Record<string, unknown>;
  await getDb().collection('categories').doc(id).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await revalidateStorefront('categories');
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'categories', 'delete');
  if (guard instanceof Response) return guard;
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
  await revalidateStorefront('categories');
  return Response.json({ ok: true });
}
