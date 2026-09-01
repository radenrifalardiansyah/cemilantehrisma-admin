import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
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
  after(() => revalidateStorefront('categories'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'categories', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db     = getDb();
  const sql    = getSql();

  const [{ count }] = await sql<{ count: string }[]>`select count(*)::int as count from products where category = ${id}`;
  if (Number(count) > 0) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${count} produk masih menggunakan kategori ini.` },
      { status: 400 },
    );
  }

  await db.collection('categories').doc(id).delete();
  after(() => revalidateStorefront('categories'));
  return Response.json({ ok: true });
}
