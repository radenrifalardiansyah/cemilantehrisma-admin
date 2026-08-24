import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  // Both the Modul screen (`modules`) and the Struktur Menu screen (`menus`,
  // which needs the module list for its module/grouping picker) may call this.
  const guard = await requirePermission(req, ['modules', 'menus'], 'view');
  if (guard instanceof Response) return guard;

  const snap = await getDb().collection('modules').orderBy('order', 'asc').get();
  const modules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ modules });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'modules', 'create');
  if (guard instanceof Response) return guard;

  const { id, name, icon } = await req.json() as { id: string; name: string; icon: string };
  if (!id || !name || !icon) return Response.json({ error: 'ID, nama, dan ikon wajib diisi.' }, { status: 400 });
  if (!/^[a-z0-9-]+$/.test(id)) {
    return Response.json({ error: 'ID modul hanya boleh huruf kecil, angka, dan tanda hubung.' }, { status: 400 });
  }

  const db  = getDb();
  const ref = db.collection('modules').doc(id);
  if ((await ref.get()).exists) {
    return Response.json({ error: `Modul dengan ID "${id}" sudah ada.` }, { status: 409 });
  }

  // max(order)+1, bukan jumlah dokumen — count menyusut tiap ada modul yang dihapus, jadi modul
  // baru bisa dapat `order` yang bentrok dengan modul lain yang masih ada (lihat komentar sama di
  // api/menus/route.ts POST).
  const siblingSnap = await db.collection('modules').get();
  const nextOrder = siblingSnap.docs.reduce((max, d) => Math.max(max, Number(d.data().order) || 0), -1) + 1;
  const now = FieldValue.serverTimestamp();
  await ref.set({ name, icon, order: nextOrder, isActive: true, createdAt: now, updatedAt: now });
  return Response.json({ id, name, icon });
}
