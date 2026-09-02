import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'suppliers', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();
  const sql = getSql();

  // Sama seperti DELETE satuan — lewati id yang masih punya riwayat pembelian bahan baku.
  // material_purchases pindah ke Postgres (Tahap 18b migrasi Fase 2).
  const linkedRows = await sql<{ supplier_id: string }[]>`
    select distinct supplier_id from material_purchases where supplier_id in ${sql(ids)}
  `;
  const linkedToPurchase = new Set(linkedRows.map(r => r.supplier_id));
  const deletable = ids.filter(id => !linkedToPurchase.has(id));
  const skippedInUse = ids.length - deletable.length;

  const batch = db.batch();
  for (const id of deletable) batch.delete(db.collection('suppliers').doc(id));
  await batch.commit();
  return Response.json({ deleted: deletable.length, skippedInUse });
}
