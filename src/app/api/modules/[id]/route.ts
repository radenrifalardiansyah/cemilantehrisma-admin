import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'modules', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data   = await req.json() as Record<string, unknown>;

  await getDb().collection('modules').doc(id).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'modules', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db     = getDb();

  const used = await db.collection('menus').where('moduleId', '==', id).get();
  if (!used.empty) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${used.size} menu masih berada di modul ini.` },
      { status: 409 },
    );
  }

  await db.collection('modules').doc(id).delete();
  return Response.json({ ok: true });
}
