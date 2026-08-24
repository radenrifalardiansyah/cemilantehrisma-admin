import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();

  // Bersihkan baris warehouse_stock produk-produk ini SEBELUM dokumen produknya hilang — sama
  // seperti DELETE satuan, supaya tidak jadi yatim permanen. `in` Firestore dibatasi 30 nilai,
  // jadi query per-chunk 30 id.
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const stockSnap = await db.collection('warehouse_stock').where('productId', 'in', chunk).get();
    if (!stockSnap.empty) {
      const wsBatch = db.batch();
      stockSnap.docs.forEach(d => wsBatch.delete(d.ref));
      await wsBatch.commit();
    }
  }

  const batch = db.batch();
  for (const id of ids) batch.delete(db.collection('products').doc(id));
  await batch.commit();
  after(() => revalidateStorefront('products'));
  return Response.json({ deleted: ids.length });
}
