import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'suppliers', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();

  // Sama seperti DELETE satuan — lewati id yang masih punya riwayat pembelian bahan baku.
  // `in` Firestore dibatasi 30 nilai.
  const linkedToPurchase = new Set<string>();
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snap = await db.collection('materialPurchases').where('supplierId', 'in', chunk).get();
    snap.docs.forEach(d => { const sid = d.data().supplierId as string | undefined; if (sid) linkedToPurchase.add(sid); });
  }
  const deletable = ids.filter(id => !linkedToPurchase.has(id));
  const skippedInUse = ids.length - deletable.length;

  const batch = db.batch();
  for (const id of deletable) batch.delete(db.collection('suppliers').doc(id));
  await batch.commit();
  return Response.json({ deleted: deletable.length, skippedInUse });
}
