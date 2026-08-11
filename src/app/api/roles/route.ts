import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'roles', 'view');
  if (guard instanceof Response) return guard;

  const snap = await getDb().collection('roles').orderBy('createdAt', 'asc').get();
  const roles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ roles });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'roles', 'create');
  if (guard instanceof Response) return guard;

  const { id, name, description } =
    await req.json() as { id: string; name: string; description?: string };

  if (!id || !name) return Response.json({ error: 'ID dan nama role wajib diisi.' }, { status: 400 });
  if (!/^[a-z0-9-]+$/.test(id)) {
    return Response.json({ error: 'ID role hanya boleh huruf kecil, angka, dan tanda hubung.' }, { status: 400 });
  }

  const db  = getDb();
  const ref = db.collection('roles').doc(id);
  if ((await ref.get()).exists) {
    return Response.json({ error: `Role dengan ID "${id}" sudah ada.` }, { status: 409 });
  }

  const now = FieldValue.serverTimestamp();
  await ref.set({ name, description: description ?? '', isSystem: false, createdAt: now, updatedAt: now });
  await db.collection('role_permissions').doc(id).set({ permissions: {}, updatedAt: now });

  return Response.json({ id, name, description: description ?? '' });
}
