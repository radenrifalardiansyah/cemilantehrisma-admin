import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'expenses', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();
  const snaps = await Promise.all(ids.map(id => db.collection('expenses').doc(id).get()));

  // Lewati entri yang otomatis dari sumber lain (mis. Pembelian Bahan Baku) — supaya tidak
  // membuat status pembayaran/stok di sumbernya jadi tidak sinkron.
  const deletable = snaps.filter(s => s.exists && !s.data()?.sourceType);
  const skipped   = snaps.length - deletable.length;

  const batch = db.batch();
  deletable.forEach(s => batch.delete(s.ref));
  await batch.commit();
  return Response.json({ deleted: deletable.length, skipped });
}
