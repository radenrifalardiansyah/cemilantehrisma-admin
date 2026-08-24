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

  // Tolak parentId yang bikin siklus — perlindungan ini sebelumnya cuma ada di klien (menyaring
  // dropdown pemilihan induk), yang bisa dilewati lewat panggilan API langsung. Kalau sampai
  // tersimpan, kode yang menyusun pohon menu (MenusTab.tsx) merekursi tanpa visited-set dan bisa
  // stack-overflow saat merender Struktur Menu.
  if (typeof data.parentId === 'string' && data.parentId) {
    if (data.parentId === id) {
      return Response.json({ error: 'Menu tidak bisa menjadi induk dirinya sendiri.' }, { status: 400 });
    }
    const allMenusSnap = await db.collection('menus').get();
    const parentById = new Map(allMenusSnap.docs.map(d => [d.id, d.data().parentId as string | null | undefined]));
    const seen = new Set<string>();
    let cursor: string | null | undefined = data.parentId;
    while (cursor) {
      if (cursor === id) {
        return Response.json({ error: 'Induk yang dipilih akan membuat struktur menu melingkar (siklus).' }, { status: 400 });
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = parentById.get(cursor);
    }
  }

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
