import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FEATURE_KEY_SET } from '@/lib/permissions';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'menus', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data   = await req.json() as Record<string, unknown>;

  if (typeof data.featureKey === 'string' && !FEATURE_KEY_SET.has(data.featureKey)) {
    return Response.json({ error: `Screen "${data.featureKey}" tidak dikenal.` }, { status: 400 });
  }

  const db  = getDb();
  const ref = db.collection('menus').doc(id);
  const current = await ref.get();
  if (!current.exists) return Response.json({ error: 'Menu tidak ditemukan.' }, { status: 404 });

  const featureKey = (data.featureKey as string | undefined) ?? current.data()!.featureKey;
  const nextActive = (data.isActive as boolean | undefined) ?? current.data()!.isActive;
  if (nextActive) {
    const dupe = await db.collection('menus')
      .where('featureKey', '==', featureKey).where('isActive', '==', true).get();
    const conflict = dupe.docs.find(d => d.id !== id);
    if (conflict) {
      return Response.json(
        { error: `Screen "${featureKey}" sudah punya menu aktif ("${conflict.data().label}").` },
        { status: 409 },
      );
    }
  }

  await ref.update({ ...data, updatedAt: FieldValue.serverTimestamp() });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'menus', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db     = getDb();

  const children = await db.collection('menus').where('parentId', '==', id).get();
  if (!children.empty) {
    return Response.json(
      { error: `Tidak bisa dihapus — ${children.size} sub-menu masih menggunakan menu ini sebagai induk.` },
      { status: 409 },
    );
  }

  await db.collection('menus').doc(id).delete();
  return Response.json({ ok: true });
}
