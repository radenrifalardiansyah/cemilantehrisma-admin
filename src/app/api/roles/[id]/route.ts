import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'roles', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;

  if (id === 'super-admin') {
    return Response.json({ error: 'Role Super Admin adalah role sistem dan tidak dapat diubah.' }, { status: 400 });
  }

  const data = await req.json() as { name?: string; description?: string };
  await getDb().collection('roles').doc(id).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'roles', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;

  if (id === 'super-admin' || id === 'admin') {
    return Response.json({ error: 'Role sistem tidak dapat dihapus.' }, { status: 400 });
  }

  const db = getDb();
  const usedBy = await db.collection('users').where('role', '==', id).get();
  if (!usedBy.empty) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${usedBy.size} pengguna masih menggunakan role ini.` },
      { status: 409 },
    );
  }

  await db.collection('roles').doc(id).delete();
  await db.collection('role_permissions').doc(id).delete();
  return Response.json({ ok: true });
}
